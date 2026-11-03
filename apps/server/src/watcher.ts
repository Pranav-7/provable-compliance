import { decodeFunctionData, getAddress, keccak256, zeroHash, type Address, type Hex, type Transaction } from 'viem';
import { abi } from '@pc/contracts';
import { Channel, Outcome, Reason, type DecisionDTO } from '@pc/shared';
import { ERROR_REASON, revertNameOf, type Chain } from './chain';
import type { CompliantNode } from './compliantNode';
import type { DecisionLog } from './decisionLog';
import type { IssuerService } from './issuer';

const POLL_MS = 300;

/**
 * Watches the chain for every transfer attempt on the token, wherever it was
 * submitted from, and records the outcome in the decision log. Attempts that
 * bypassed the bank's node are captured too: they are public on-chain.
 */
export class ChainWatcher {
  private lastBlock = 0n;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly chain: Chain,
    private readonly issuer: IssuerService,
    private readonly node: CompliantNode,
    private readonly log: DecisionLog,
    private readonly onDecision: (d: DecisionDTO) => void,
  ) {}

  async start(): Promise<void> {
    this.lastBlock = await this.chain.publicClient.getBlockNumber({ cacheTime: 0 });
    this.timer = setInterval(() => {
      this.running ??= this.poll().finally(() => (this.running = null));
    }, POLL_MS);
  }

  /** Skips everything up to the current head (used after a chain reset). */
  async resync(): Promise<void> {
    await this.running;
    this.lastBlock = await this.chain.publicClient.getBlockNumber({ cacheTime: 0 });
  }

  /** Processes any blocks not yet seen. Exposed so callers can wait for a decision deterministically. */
  async flush(): Promise<void> {
    await this.running;
    await this.poll();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async poll(): Promise<void> {
    const head = await this.chain.publicClient.getBlockNumber({ cacheTime: 0 });
    while (this.lastBlock < head) {
      const next = this.lastBlock + 1n;
      const block = await this.chain.publicClient.getBlock({ blockNumber: next, includeTransactions: true });
      for (const tx of block.transactions) await this.inspect(tx);
      this.lastBlock = next;
    }
  }

  private async inspect(tx: Transaction): Promise<void> {
    const token = this.chain.addresses.token;
    if (!tx.to || getAddress(tx.to) !== getAddress(token)) return;

    let call: { functionName: string; args?: readonly unknown[] };
    try {
      call = decodeFunctionData({ abi: abi('CompliantToken'), data: tx.input }) as typeof call;
    } catch {
      return;
    }
    if (call.functionName !== 'transferWithProof' && call.functionName !== 'transfer') return;

    const [to, amount] = (call.args ?? []) as [Address, bigint];
    const proof = call.functionName === 'transferWithProof' ? ((call.args ?? [])[4] as Hex) : '0x';
    const envelope = call.functionName === 'transferWithProof' ? ((call.args ?? [])[5] as Hex) : '0x';
    const receipt = await this.chain.publicClient.getTransactionReceipt({ hash: tx.hash });

    let outcome = Outcome.Settled;
    let reason = Reason.None;
    if (receipt.status !== 'success') {
      outcome = Outcome.Blocked;
      reason = await this.revertReason(tx);
    }

    const policy = this.issuer.policy;
    const nonce = await this.chain
      .read<bigint>(this.chain.addresses.complianceGate, 'ComplianceGate', 'transferNonce', [tx.from], receipt.blockNumber - 1n)
      .catch(() => 0n);
    const registryRoot = await this.chain
      .read<Hex>(this.chain.addresses.credentialRegistry, 'CredentialRegistry', 'root', [], receipt.blockNumber)
      .catch(() => zeroHash);

    const decision = this.log.append({
      channel: this.node.forwarded.has(tx.hash) ? Channel.CompliantNode : Channel.Direct,
      from: getAddress(tx.from),
      to: getAddress(to),
      fromId: this.issuer.holderIdOf(tx.from),
      toId: this.issuer.holderIdOf(to),
      amount,
      outcome,
      reason,
      policyVersion: policy?.version ?? 0,
      policyHash: policy?.documentHash ?? zeroHash,
      registryRoot,
      proofHash: proof === '0x' ? zeroHash : keccak256(proof),
      envelopeHash: !envelope || envelope === '0x' ? zeroHash : keccak256(envelope),
      nonce,
      txRef: tx.hash,
    });
    this.onDecision(decision);
  }

  /** Replays a failed transaction against the state just before it to recover the revert reason. */
  private async revertReason(tx: Transaction): Promise<Reason> {
    try {
      await this.chain.publicClient.call({
        account: tx.from,
        to: tx.to!,
        data: tx.input,
        blockNumber: tx.blockNumber! - 1n,
      });
      return Reason.Other;
    } catch (err) {
      const name = revertNameOf(err);
      return (name ? ERROR_REASON[name] : undefined) ?? Reason.Other;
    }
  }
}
