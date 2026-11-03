import {
  BaseError,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  RpcRequestError,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hardhat } from 'viem/chains';
import { abi, revertErrorName } from '@pc/contracts';
import { UnprovableStatementError, type EligibilityPublicInputs, type GeneratedProof } from '@pc/circuits';
import {
  COUNTRY_NAMES,
  DEV_PRIVATE_KEYS,
  HOLDERS,
  encryptEnvelope,
  envelopeHash,
  INVESTOR_CLASS,
  ISO_NUMERIC,
  REASON_LABEL,
  Reason,
  fieldHex,
  formatUnits,
  receiveBinding,
  toBaseUnits,
  transferBinding,
  type ActionResult,
  type CaseConfig,
  type ProofMode,
  type CredentialAttributes,
  type Deployment,
  type HolderId,
  type HolderView,
  type MembershipWitness,
  type ProofArtifact,
  type Route,
} from '@pc/shared';
import type { ProofSystem } from './proofSystem';

/**
 * How a holder's wallet builds the proof for a transfer:
 *   fresh   fetch a fresh witness from the issuer and prove against the current registry root
 *   stale   reuse the credential and witness the wallet already holds, even if the registry has moved on
 *   forged  submit arbitrary bytes as a "proof" (models a holder who cannot prove eligibility)
 */
export type { ProofMode } from '@pc/shared';

interface HeldCredential {
  attributes: CredentialAttributes;
  witness: MembershipWitness;
  epoch: number;
}

const TX_GAS = 8_000_000n;
const CLASS_NAME = Object.fromEntries(Object.entries(INVESTOR_CLASS).map(([k, v]) => [v, k])) as Record<number, string>;
const COUNTRY_ALPHA = Object.fromEntries(Object.entries(ISO_NUMERIC).map(([k, v]) => [v, k])) as Record<number, string>;

/**
 * Holder-side wallets. Each holder keeps their own credential, generates proofs
 * locally (the issuer never sees the private inputs) and submits transactions
 * either through the bank's compliant node or straight to the chain.
 */
export class HolderWallets {
  private readonly publicClient: PublicClient;
  private held = new Map<HolderId, HeldCredential>();
  private revoked = new Set<HolderId>();

  constructor(
    private readonly deployment: Deployment,
    private readonly bankUrl: string,
    private readonly proofs: ProofSystem,
    readonly study: CaseConfig,
  ) {
    this.publicClient = createPublicClient({ chain: hardhat, transport: http(deployment.rpcUrl) });
  }

  reset(): void {
    this.held.clear();
    this.revoked.clear();
  }

  address(id: HolderId): Address {
    return privateKeyToAccount(DEV_PRIVATE_KEYS[HOLDERS[id].account]).address;
  }

  private walletFor(id: HolderId, route: Route) {
    const url = route === 'compliant-node' ? `${this.bankUrl}/rpc` : this.deployment.rpcUrl;
    return createWalletClient({ chain: hardhat, transport: http(url), account: privateKeyToAccount(DEV_PRIVATE_KEYS[HOLDERS[id].account]) });
  }

  private read<T>(address: Address, name: Parameters<typeof abi>[0], functionName: string, args: readonly unknown[] = []): Promise<T> {
    return this.publicClient.readContract({ address, abi: abi(name), functionName, args }) as Promise<T>;
  }

  // ---------------------------------------------------------------------------
  // Credentials
  // ---------------------------------------------------------------------------

  /** Collects the holder's credential and current membership witness from the issuer. */
  async sync(id: HolderId): Promise<'active' | 'revoked' | 'none'> {
    const res = await fetch(`${this.bankUrl}/api/bank/credentials/${id}`);
    if (res.status === 410) {
      if (this.held.has(id)) this.revoked.add(id);
      return this.held.has(id) ? 'revoked' : 'none';
    }
    if (!res.ok) throw new Error(`Issuer refused credential request: ${res.status}`);
    const body = (await res.json()) as {
      epoch: number;
      attributes: { salt: string; holder: string; country: number; investorClass: number; expiry: string };
      witness: { leafIndex: number; path: string[]; root: string };
    };
    this.held.set(id, {
      epoch: body.epoch,
      attributes: {
        salt: BigInt(body.attributes.salt),
        holder: BigInt(body.attributes.holder),
        country: body.attributes.country,
        investorClass: body.attributes.investorClass,
        expiry: BigInt(body.attributes.expiry),
      },
      witness: { leafIndex: body.witness.leafIndex, path: body.witness.path.map(BigInt), root: BigInt(body.witness.root) },
    });
    this.revoked.delete(id);
    return 'active';
  }

  async views(): Promise<HolderView[]> {
    const { token, complianceGate } = this.deployment.contracts;
    return Promise.all(
      this.study.holders.map(async (id) => {
        const address = this.address(id);
        const [balance, hasReceivePass] = await Promise.all([
          this.read<bigint>(token, 'CompliantToken', 'balanceOf', [address]),
          this.read<boolean>(complianceGate, 'ComplianceGate', 'hasReceivePass', [address]),
        ]);
        const held = this.held.get(id);
        return {
          id,
          name: HOLDERS[id].name,
          role: HOLDERS[id].role,
          address,
          balance: formatUnits(balance),
          hasReceivePass,
          credential: held
            ? {
                country: COUNTRY_ALPHA[held.attributes.country] ?? String(held.attributes.country),
                countryNumeric: held.attributes.country,
                investorClass: CLASS_NAME[held.attributes.investorClass] ?? String(held.attributes.investorClass),
                expiry: Number(held.attributes.expiry),
                leafIndex: held.witness.leafIndex,
              }
            : null,
          credentialStatus: !held ? 'none' : this.revoked.has(id) ? 'revoked' : 'active',
        } satisfies HolderView;
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Proving
  // ---------------------------------------------------------------------------

  /**
   * Encrypts the holder's credential data for this transfer to the auditor.
   * Its hash is folded into the proof's binding.
   */
  private sealEnvelope(id: HolderId, held: HeldCredential | undefined, proofRoot: bigint, policyVersion: number, to: Address, amount: bigint, nonce: bigint): Hex {
    return encryptEnvelope({
      v: 1,
      caseId: this.study.id,
      holder: this.address(id),
      country: held?.attributes.country ?? 0,
      investorClass: held?.attributes.investorClass ?? 0,
      expiry: (held?.attributes.expiry ?? 0n).toString(),
      salt: (held?.attributes.salt ?? 0n).toString(),
      leafIndex: held?.witness.leafIndex ?? 0,
      path: (held?.witness.path ?? []).map(String),
      proofRoot: fieldHex(proofRoot),
      policyVersion,
      to,
      amount: amount.toString(),
      nonce: nonce.toString(),
    });
  }

  private async chainContext(): Promise<ChainContext> {
    const { policyRegistry, credentialRegistry } = this.deployment.contracts;
    const [policy, policyVersion, root, epoch, block] = await Promise.all([
      this.read<{ allowedCountries: readonly number[]; allowedClassMask: number }>(policyRegistry, 'PolicyRegistry', 'active'),
      this.read<number>(policyRegistry, 'PolicyRegistry', 'activeVersion'),
      this.read<Hex>(credentialRegistry, 'CredentialRegistry', 'root'),
      this.read<bigint>(credentialRegistry, 'CredentialRegistry', 'epoch'),
      this.publicClient.getBlock(),
    ]);
    return { policy, policyVersion: Number(policyVersion), root: BigInt(root), epoch, now: block.timestamp };
  }

  private async proveFor(
    id: HolderId,
    mode: Exclude<ProofMode, 'forged'>,
    binding: (ctx: ChainContext, held: HeldCredential, registryRoot: bigint) => Hex,
  ) {
    if (mode === 'fresh') await this.sync(id);
    const held = this.held.get(id);
    if (!held) throw new UnprovableStatementError('no credential issued to this holder');
    const ctx = await this.chainContext();
    const registryRoot = mode === 'stale' ? held.witness.root : ctx.root;
    const pub: EligibilityPublicInputs = {
      registryRoot,
      allowedCountries: [...ctx.policy.allowedCountries],
      allowedClassMask: ctx.policy.allowedClassMask,
      now: ctx.now,
      holder: this.address(id),
      binding: binding(ctx, held, registryRoot),
    };
    const proof = await this.proofs.prove({ credential: held.attributes, membership: held.witness }, pub);
    return { proof, pub, ctx };
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /** Proves eligibility to receive against the current registry root and registers the pass. */
  async registerReceivePass(id: HolderId, route: Route = 'compliant-node'): Promise<ActionResult> {
    const address = this.address(id);
    let built: Awaited<ReturnType<HolderWallets['proveFor']>>;
    try {
      built = await this.proveFor(id, 'fresh', (ctx) =>
        receiveBinding({ chainId: this.deployment.chainId, gate: this.deployment.contracts.complianceGate, holder: address, epoch: ctx.epoch }),
      );
    } catch (err) {
      return this.unprovable(err, route);
    }
    const data = encodeFunctionData({
      abi: abi('ComplianceGate'),
      functionName: 'registerReceivePass',
      args: [fieldHex(built.pub.registryRoot), built.pub.now, built.proof.proof],
    });
    return this.submit(id, route, this.deployment.contracts.complianceGate, data, artifact(built.proof, built.pub, this.study.policy.version));
  }

  async transfer(p: { from: HolderId; to: HolderId; amount: string; route: Route; mode?: ProofMode }): Promise<ActionResult> {
    const mode = p.mode ?? 'fresh';
    const amount = toBaseUnits(p.amount);
    const from = this.address(p.from);
    const to = this.address(p.to);
    const { token, complianceGate } = this.deployment.contracts;

    const nonce = await this.read<bigint>(complianceGate, 'ComplianceGate', 'transferNonce', [from]);

    if (mode === 'forged') {
      await this.sync(p.from).catch(() => undefined);
      const ctx = await this.chainContext();
      const envelope = this.sealEnvelope(p.from, this.held.get(p.from), ctx.root, ctx.policyVersion, to, amount, nonce);
      const junk = `0x${'ab'.repeat(32 * 8)}` as Hex;
      const data = encodeFunctionData({
        abi: abi('CompliantToken'),
        functionName: 'transferWithProof',
        args: [to, amount, fieldHex(ctx.root), ctx.now, junk, envelope],
      });
      return this.submit(p.from, p.route, token, data, null);
    }

    let built: Awaited<ReturnType<HolderWallets['proveFor']>>;
    let envelope: Hex = '0x';
    try {
      built = await this.proveFor(p.from, mode, (ctx, held, registryRoot) => {
        envelope = this.sealEnvelope(p.from, held, registryRoot, ctx.policyVersion, to, amount, nonce);
        return transferBinding({ chainId: this.deployment.chainId, token, from, to, amount, nonce, envelopeHash: envelopeHash(envelope) });
      });
    } catch (err) {
      return this.unprovable(err, p.route);
    }
    const data = encodeFunctionData({
      abi: abi('CompliantToken'),
      functionName: 'transferWithProof',
      args: [to, amount, fieldHex(built.pub.registryRoot), built.pub.now, built.proof.proof, envelope],
    });
    return this.submit(p.from, p.route, token, data, artifact(built.proof, built.pub, this.study.policy.version, envelope));
  }

  private unprovable(err: unknown, route: Route): ActionResult {
    if (!(err instanceof UnprovableStatementError)) throw err;
    const reason = REASON_FOR_ASSERTION[err.reason] ?? Reason.NoCredential;
    return {
      ok: false,
      stage: 'prove',
      route,
      reason,
      message: `No valid proof exists: ${err.reason}.`,
      proof: null,
      txHash: null,
      gasUsed: null,
      blockNumber: null,
    };
  }

  private async submit(id: HolderId, route: Route, to: Address, data: Hex, proof: ProofArtifact | null): Promise<ActionResult> {
    const wallet = this.walletFor(id, route);
    let hash: Hex;
    try {
      hash = await wallet.sendTransaction({ to, data, gas: TX_GAS, account: wallet.account, chain: hardhat });
    } catch (err) {
      const rpc = err instanceof BaseError ? (err.walk((e) => e instanceof RpcRequestError) as RpcRequestError | null) : null;
      if (rpc && rpc.code === -32003) {
        const reason = ((rpc.data as { reason?: Reason } | undefined)?.reason ?? Reason.Other) as Reason;
        return { ok: false, stage: 'submit', route, reason, message: `Blocked by the bank's compliant node: ${REASON_LABEL[reason]}.`, proof, txHash: null, gasUsed: null, blockNumber: null };
      }
      throw err;
    }
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === 'success') {
      return { ok: true, stage: 'settle', route, reason: Reason.None, message: 'Settled on-chain.', proof, txHash: hash, gasUsed: receipt.gasUsed.toString(), blockNumber: Number(receipt.blockNumber) };
    }
    const reason = await this.revertReason(id, to, data, receipt.blockNumber);
    return {
      ok: false,
      stage: 'settle',
      route,
      reason,
      message: `Rejected by the token contract: ${REASON_LABEL[reason]}.`,
      proof,
      txHash: hash,
      gasUsed: receipt.gasUsed.toString(),
      blockNumber: Number(receipt.blockNumber),
    };
  }

  private async revertReason(id: HolderId, to: Address, data: Hex, blockNumber: bigint): Promise<Reason> {
    try {
      await this.publicClient.call({ account: this.address(id), to, data, blockNumber: blockNumber - 1n });
      return Reason.Other;
    } catch (err) {
      const name = revertErrorName(err);
      return (name ? ERROR_REASON[name] : undefined) ?? Reason.Other;
    }
  }
}

const ERROR_REASON: Record<string, Reason> = {
  StaleRegistryRoot: Reason.StaleRegistryRoot,
  RecipientNotEligible: Reason.RecipientNotEligible,
  MaxBalanceExceeded: Reason.MaxBalance,
  InvalidProof: Reason.InvalidProof,
  ProofRequired: Reason.ProofRequired,
  ProofTimestampOutOfRange: Reason.InvalidProof,
  AuditEnvelopeRequired: Reason.AuditEnvelopeMissing,
};

interface ChainContext {
  policy: { allowedCountries: readonly number[]; allowedClassMask: number };
  policyVersion: number;
  root: bigint;
  epoch: bigint;
  now: bigint;
}

const REASON_FOR_ASSERTION: Record<string, Reason> = {
  'credential not in registry': Reason.NoCredential,
  'jurisdiction not permitted': Reason.Jurisdiction,
  'investor class not permitted': Reason.InvestorClass,
  'credential expired': Reason.CredentialExpired,
  'no credential issued to this holder': Reason.NoCredential,
};

function artifact(proof: GeneratedProof, pub: EligibilityPublicInputs, policyVersion: number, envelope?: Hex): ProofArtifact {
  const countries = pub.allowedCountries.filter((c) => c !== 0).map((c) => COUNTRY_ALPHA[c] ?? String(c));
  const classes = Object.entries(INVESTOR_CLASS)
    .filter(([, bit]) => (pub.allowedClassMask >> bit) & 1)
    .map(([name]) => name);
  return {
    proofHex: proof.proof,
    proofBytes: (proof.proof.length - 2) / 2,
    provingMs: proof.provingMs,
    registryRoot: fieldHex(pub.registryRoot),
    validAt: Number(pub.now),
    publicInputs: [
      { label: 'Credential registry root', value: fieldHex(pub.registryRoot) },
      { label: `Permitted jurisdictions (policy v${policyVersion})`, value: countries.map((c) => `${c} ${COUNTRY_NAMES[c] ? `(${COUNTRY_NAMES[c]})` : ''}`.trim()).join(', ') },
      { label: 'Permitted investor classes', value: classes.join(', ') },
      { label: 'Proof time', value: new Date(Number(pub.now) * 1000).toISOString().replace('.000Z', 'Z') },
      { label: 'Holder address', value: pub.holder },
      { label: 'Bound to this action', value: pub.binding },
    ],
    envelope: envelope ? { hash: envelopeHash(envelope), bytes: (envelope.length - 2) / 2 } : null,
  };
}
