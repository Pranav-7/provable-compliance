import {
  decodeFunctionData,
  getAddress,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  zeroHash,
  type Address,
  type Hex,
  type TransactionSerialized,
} from 'viem';
import { abi } from '@pc/contracts';
import { Channel, Outcome, REASON_LABEL, Reason, ISO_NUMERIC, INVESTOR_CLASS, type DecisionDTO } from '@pc/shared';
import type { Chain } from './chain';
import type { IssuerService } from './issuer';
import type { DecisionLog } from './decisionLog';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string | null;
  method: string;
  params?: unknown[];
}

export const BLOCKED_BY_NODE = -32003;

/**
 * The issuing bank's compliant RPC node: the primary control. It screens every
 * outgoing token transfer against the issuer's own KYC records and policy before
 * broadcasting it. The token's proof check is a second, independent check that
 * travels with the asset, so the same rules hold when a transfer arrives through
 * another institution's infrastructure, and every decision leaves evidence.
 */
export class CompliantNode {
  /** Transaction hashes this node broadcast, so the watcher can attribute the route. */
  readonly forwarded = new Set<Hex>();

  constructor(
    private readonly chain: Chain,
    private readonly issuer: IssuerService,
    private readonly log: DecisionLog,
    private readonly onDecision: (d: DecisionDTO) => void,
  ) {}

  reset(): void {
    this.forwarded.clear();
  }

  async handle(body: JsonRpcRequest | JsonRpcRequest[]): Promise<unknown> {
    return Array.isArray(body) ? Promise.all(body.map((r) => this.handleOne(r))) : this.handleOne(body);
  }

  private async handleOne(req: JsonRpcRequest): Promise<unknown> {
    if (req.method === 'eth_sendRawTransaction') {
      const raw = (req.params?.[0] ?? '0x') as Hex;
      const verdict = await this.screen(raw);
      if (verdict.reason !== Reason.None) {
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: { code: BLOCKED_BY_NODE, message: `Blocked by compliant node: ${REASON_LABEL[verdict.reason]}`, data: { reason: verdict.reason } },
        };
      }
      this.forwarded.add(keccak256(raw));
    }
    return this.forward(req);
  }

  private async forward(req: JsonRpcRequest): Promise<unknown> {
    const res = await fetch(this.chain.deployment.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
    return res.json();
  }

  /** Pre-trade screening. Returns Reason.None to let the transaction through. */
  private async screen(raw: Hex): Promise<{ reason: Reason }> {
    let tx: ReturnType<typeof parseTransaction>;
    let from: Address;
    try {
      tx = parseTransaction(raw);
      from = await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerialized });
    } catch {
      return { reason: Reason.None }; // Not ours to judge: let the chain reject malformed input.
    }
    if (!tx.to || getAddress(tx.to) !== getAddress(this.chain.addresses.token) || !tx.data) return { reason: Reason.None };

    let call: { functionName: string; args?: readonly unknown[] };
    try {
      call = decodeFunctionData({ abi: abi('CompliantToken'), data: tx.data }) as typeof call;
    } catch {
      return { reason: Reason.None };
    }
    if (call.functionName !== 'transferWithProof') return { reason: Reason.None };

    const [to, amount, , , proof, envelope] = (call.args ?? []) as [Address, bigint, Hex, bigint, Hex, Hex];
    const stateBlock = await this.chain.publicClient.getBlockNumber({ cacheTime: 0 });
    const reason = await this.evaluate(from, to, amount);
    if (reason !== Reason.None) {
      const policy = this.issuer.policy;
      const nonce = await this.chain.read<bigint>(this.chain.addresses.complianceGate, 'ComplianceGate', 'transferNonce', [from]);
      const decision = this.log.append({
        channel: Channel.CompliantNode,
        from: getAddress(from),
        to: getAddress(to),
        fromId: this.issuer.holderIdOf(from),
        toId: this.issuer.holderIdOf(to),
        amount,
        outcome: Outcome.Blocked,
        reason,
        policyVersion: policy?.version ?? 0,
        policyHash: policy?.documentHash ?? zeroHash,
        registryRoot: this.issuer.registry?.root ?? zeroHash,
        proofHash: keccak256(proof),
        envelopeHash: envelope && envelope !== '0x' ? keccak256(envelope) : zeroHash,
        nonce,
        txRef: keccak256(raw),
      });
      this.log.archiveRawTx(decision.seq, raw, stateBlock);
      this.onDecision(decision);
    }
    return { reason };
  }

  private async evaluate(from: Address, to: Address, amount: bigint): Promise<Reason> {
    const policy = this.issuer.policy;
    const sender = this.issuer.recordByAddress(from);
    if (!policy || !sender) return Reason.NoCredential;
    if (sender.status === 'revoked') return Reason.Sanctioned;
    if (((policy.allowedClassMask >> INVESTOR_CLASS[sender.investorClass]) & 1) === 0) return Reason.InvestorClass;
    if (!policy.allowedCountries.includes(ISO_NUMERIC[sender.country])) return Reason.Jurisdiction;
    if (sender.expiry <= BigInt(Math.floor(Date.now() / 1000))) return Reason.CredentialExpired;

    const { complianceGate, token } = this.chain.addresses;
    const hasPass = await this.chain.read<boolean>(complianceGate, 'ComplianceGate', 'hasReceivePass', [to]);
    if (!hasPass) return Reason.RecipientNotEligible;
    const balance = await this.chain.read<bigint>(token, 'CompliantToken', 'balanceOf', [to]);
    if (balance + amount > BigInt(policy.maxHolderBalance)) return Reason.MaxBalance;
    return Reason.None;
  }
}
