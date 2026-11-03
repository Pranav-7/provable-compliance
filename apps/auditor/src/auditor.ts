import { Barretenberg } from '@aztec/bb.js';
import {
  decodeFunctionData,
  getAddress,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  zeroHash,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionSerialized,
} from 'viem';
import { poseidon2From } from '@pc/circuits';
import { abi, clients } from '@pc/contracts';
import {
  COUNTRY_NAMES,
  CredentialTree,
  DecisionTree,
  EnvelopeError,
  INVESTOR_CLASS,
  ISO_NUMERIC,
  Outcome,
  REASON_LABEL,
  Reason,
  credentialLeaf,
  decisionLeaf,
  decryptEnvelope,
  envelopeHash,
  fieldHex,
  transferBinding,
  type AuditCheck,
  type AuditRecordProof,
  type AuditReport,
  type CaseId,
  type DecisionRecord,
  type Deployment,
  type EnvelopePayload,
} from '@pc/shared';

export type AuditMode = AuditReport['mode'];

interface OnChainPolicy {
  documentHash: Hex;
  allowedCountries: readonly number[];
  allowedClassMask: number;
  maxHolderBalance: bigint;
}

const VERIFIER_ABI = [
  {
    type: 'function',
    name: 'verify',
    stateMutability: 'view',
    inputs: [
      { name: 'proof', type: 'bytes' },
      { name: 'publicInputs', type: 'bytes32[]' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

/** Reasons that describe the same underlying fact, seen with or without the private data. */
const FAMILIES: Reason[][] = [
  [Reason.Sanctioned, Reason.StaleRegistryRoot, Reason.NoCredential],
  [Reason.InvestorClass, Reason.Jurisdiction, Reason.CredentialExpired, Reason.InvalidProof],
];
const sameFamily = (a: Reason, b: Reason) => a === b || FAMILIES.some((f) => f.includes(a) && f.includes(b));

const CLASS_NAME = Object.fromEntries(Object.entries(INVESTOR_CLASS).map(([k, v]) => [v, k])) as Record<number, string>;
const COUNTRY_ALPHA = Object.fromEntries(Object.entries(ISO_NUMERIC).map(([k, v]) => [v, k])) as Record<number, string>;

/**
 * An auditor that trusts nothing the bank says. It takes one decision record and
 * its inclusion proof, then checks every claim against the public chain:
 *
 *   proof        re-verifies the zero-knowledge proof and the public state. The
 *                auditor learns that the rule held, never the holder's attributes.
 *   proof+data   additionally decrypts the audit envelope that travelled with the
 *                transfer, re-derives the credential from it, and re-runs the policy.
 *
 * The analogy is a validity rollup (proof only) next to a rollup that also posts
 * its data: the proof convinces, the data lets you reconstruct and explain.
 */
export class Auditor {
  private constructor(
    private readonly bb: Barretenberg,
    private readonly privateKey: Hex,
  ) {}

  static async create(privateKey: Hex): Promise<Auditor> {
    return new Auditor(await Barretenberg.new({ skipSrsInit: true }), privateKey);
  }

  async destroy(): Promise<void> {
    await this.bb.destroy();
  }

  async audit(input: {
    caseId: CaseId;
    deployment: Deployment;
    evidence: AuditRecordProof;
    /** Fetches the raw bytes of a transaction the bank's node held back (never broadcast). */
    archived: (seq: number) => Promise<{ raw: Hex; stateBlock: string } | null>;
    mode: AuditMode;
  }): Promise<AuditReport> {
    const { deployment, evidence, mode } = input;
    const { publicClient } = clients(deployment.rpcUrl);
    const c = deployment.contracts;
    const read = <T>(address: Address, name: Parameters<typeof abi>[0], fn: string, args: readonly unknown[] = [], blockNumber?: bigint) =>
      publicClient.readContract({ address, abi: abi(name), functionName: fn, args, blockNumber }) as Promise<T>;

    const dto = evidence.record;
    const record: DecisionRecord = {
      seq: dto.seq,
      timestamp: dto.timestamp,
      channel: dto.channel,
      from: dto.from,
      to: dto.to,
      amount: BigInt(dto.amount),
      outcome: dto.outcome,
      reason: dto.reason,
      policyVersion: dto.policyVersion,
      policyHash: dto.policyHash,
      registryRoot: dto.registryRoot,
      proofHash: dto.proofHash,
      envelopeHash: dto.envelopeHash,
      nonce: BigInt(dto.nonce),
      txRef: dto.txRef,
    };
    const checks: AuditCheck[] = [];
    const check = (id: string, label: string, ok: boolean, detail: string, m: AuditCheck['mode'] = 'proof') => {
      checks.push({ id, label, ok, detail, mode: m });
      return ok;
    };

    // 1. The record is committed to an anchored batch.
    const leaf = decisionLeaf(record);
    check('leaf', 'Record hashes to its leaf', leaf.toLowerCase() === evidence.leaf.toLowerCase(), short(leaf));
    const anchored = await read<{ root: Hex }>(c.decisionLogAnchor, 'DecisionLogAnchor', 'batch', [BigInt(evidence.batch.batchId)]).catch(() => null);
    check(
      'anchor',
      'Leaf is in a root anchored on-chain',
      !!anchored && DecisionTree.verify(leaf, evidence.siblings, anchored.root),
      anchored ? `batch ${evidence.batch.batchId}, root ${short(anchored.root)}` : 'batch not found on-chain',
    );

    // 2. The policy the record cites is the one the issuer published.
    const policy = await read<OnChainPolicy>(c.policyRegistry, 'PolicyRegistry', 'policyAt', [record.policyVersion]).catch(() => null);
    check(
      'policy',
      'Policy fingerprint matches the published version',
      !!policy && policy.documentHash.toLowerCase() === record.policyHash.toLowerCase(),
      `version ${record.policyVersion}, ${short(record.policyHash)}`,
    );

    // 3. Get the exact transaction bytes the decision was taken on.
    const tx = await this.locate(publicClient, record, input.archived);
    check(
      'tx',
      tx.source === 'chain' ? 'Transaction found on-chain' : 'Held-back transaction matches the record',
      tx.ok,
      tx.detail,
    );

    let derived: Reason = Reason.Other;
    let disclosed: AuditReport['disclosed'] = null;

    if (tx.ok && tx.call && policy) {
      const { to, amount, proofRoot, validAt, proof, envelope } = tx.call;
      const stateBlock = tx.stateBlock;
      check(
        'payload',
        'Transfer details match the record',
        getAddress(to) === getAddress(record.to) && amount === record.amount && getAddress(tx.from!) === getAddress(record.from),
        `${short(record.from)} → ${short(record.to)}`,
      );
      check('proof-hash', 'Proof bytes match the recorded hash', keccak256(proof) === record.proofHash, short(record.proofHash));
      const envOk = check(
        'envelope-hash',
        'Audit envelope matches the recorded hash',
        envelope !== '0x' && envelopeHash(envelope) === record.envelopeHash,
        `${(envelope.length - 2) / 2} bytes, encrypted to the auditor`,
      );

      // Public state at the moment of decision.
      const [rootThen, epochThen, passThen, balanceThen] = await Promise.all([
        read<Hex>(c.credentialRegistry, 'CredentialRegistry', 'root', [], stateBlock),
        read<bigint>(c.credentialRegistry, 'CredentialRegistry', 'epoch', [], stateBlock),
        read<boolean>(c.complianceGate, 'ComplianceGate', 'hasReceivePass', [to], stateBlock),
        read<bigint>(c.token, 'CompliantToken', 'balanceOf', [to], stateBlock),
      ]);
      const proofRootCurrent = proofRoot.toLowerCase() === rootThen.toLowerCase();
      const binding = transferBinding({
        chainId: deployment.chainId,
        token: c.token,
        from: record.from,
        to: record.to,
        amount: record.amount,
        nonce: record.nonce,
        envelopeHash: envOk ? record.envelopeHash : zeroHash,
      });
      const inputs = await read<Hex[]>(c.complianceGate, 'ComplianceGate', 'publicInputsFor', [proofRoot, record.policyVersion, record.from, validAt, binding]);
      const proofValid = await publicClient
        .readContract({ address: c.verifier, abi: VERIFIER_ABI, functionName: 'verify', args: [proof, inputs] })
        .catch(() => false);
      check(
        'zk',
        'Zero-knowledge proof verifies',
        proofValid,
        proofValid ? `against registry root ${short(proofRoot)}, bound to this transfer and envelope` : 'the proof does not verify for these public inputs',
      );
      check(
        'root',
        'Proof was built on the registry root in force',
        proofRootCurrent,
        proofRootCurrent ? `epoch ${epochThen}` : `root ${short(proofRoot)} had been superseded (registry at epoch ${epochThen})`,
      );
      check('recipient', 'Recipient held a receive pass', passThen, passThen ? 'registered for the current registry epoch' : 'no current receive pass');
      const cap = BigInt(policy.maxHolderBalance);
      const withinCap = balanceThen + amount <= cap;
      check('cap', 'Recipient stays within the balance cap', withinCap, `${fmt(balanceThen + amount)} of ${fmt(cap)}`);

      // Proof only: what the public evidence shows, in the order the token checks it.
      derived = !proofRootCurrent ? Reason.StaleRegistryRoot : !passThen ? Reason.RecipientNotEligible : !withinCap ? Reason.MaxBalance : !proofValid ? Reason.InvalidProof : Reason.None;

      if (mode === 'proof+data') {
        const data = await this.openEnvelope(envelope, record, check);
        if (data) {
          disclosed = {
            holder: data.holder,
            country: COUNTRY_ALPHA[data.country] ?? String(data.country),
            investorClass: CLASS_NAME[data.investorClass] ?? String(data.investorClass),
            expiry: Number(data.expiry),
            leafIndex: data.leafIndex,
          };
          const credentialRoot = await this.credentialRoot(data);
          const inProofRoot = check(
            'membership',
            'Disclosed credential is in the proof’s registry root',
            credentialRoot.toLowerCase() === proofRoot.toLowerCase(),
            `leaf ${data.leafIndex} → ${short(credentialRoot)}`,
            'data',
          );
          const member = inProofRoot && proofRootCurrent;
          const classOk = check(
            'class',
            'Investor class is permitted by the policy',
            ((policy.allowedClassMask >> data.investorClass) & 1) === 1,
            disclosed.investorClass,
            'data',
          );
          const countryOk = check(
            'country',
            'Jurisdiction is permitted by the policy',
            policy.allowedCountries.includes(data.country),
            COUNTRY_NAMES[disclosed.country] ?? disclosed.country,
            'data',
          );
          const notExpired = check('expiry', 'Credential was in date', BigInt(data.expiry) > validAt, new Date(Number(data.expiry) * 1000).toISOString().slice(0, 10), 'data');

          // Proof + data: the full reasoning, in the order the bank's node screens it.
          derived = !member
            ? Reason.StaleRegistryRoot
            : !classOk
              ? Reason.InvestorClass
              : !countryOk
                ? Reason.Jurisdiction
                : !notExpired
                  ? Reason.CredentialExpired
                  : !passThen
                    ? Reason.RecipientNotEligible
                    : !withinCap
                      ? Reason.MaxBalance
                      : !proofValid
                        ? Reason.InvalidProof
                        : Reason.None;
        } else {
          derived = Reason.Other;
        }
      }
    }

    const integrity = checks.filter((k) => ['leaf', 'anchor', 'policy', 'tx', 'payload', 'proof-hash', 'envelope-hash', 'decrypt'].includes(k.id)).every((k) => k.ok);
    const outcome = derived === Reason.None ? Outcome.Settled : Outcome.Blocked;
    const matchesRecord = integrity && outcome === record.outcome && (outcome === Outcome.Settled || sameFamily(derived, record.reason));
    return {
      caseId: input.caseId,
      seq: record.seq,
      mode,
      recordedOutcome: { outcome: record.outcome, reason: record.reason },
      source: tx.source,
      checks,
      disclosed,
      conclusion: { outcome, reason: derived, matchesRecord, summary: summarise(mode, record, derived, matchesRecord, integrity) },
    };
  }

  /** Finds the transaction bytes: on-chain if it was broadcast, otherwise the bank's archive, checked against txRef. */
  private async locate(client: PublicClient, record: DecisionRecord, archived: (seq: number) => Promise<{ raw: Hex; stateBlock: string } | null>) {
    type Call = { to: Address; amount: bigint; proofRoot: Hex; validAt: bigint; proof: Hex; envelope: Hex };
    const decode = (data: Hex): Call | null => {
      try {
        const d = decodeFunctionData({ abi: abi('CompliantToken'), data }) as { functionName: string; args: readonly unknown[] };
        if (d.functionName !== 'transferWithProof') return null;
        const [to, amount, proofRoot, validAt, proof, envelope] = d.args as [Address, bigint, Hex, bigint, Hex, Hex];
        return { to, amount, proofRoot, validAt, proof, envelope };
      } catch {
        return null;
      }
    };

    const onChain = await client.getTransaction({ hash: record.txRef }).catch(() => null);
    if (onChain) {
      const receipt = await client.getTransactionReceipt({ hash: record.txRef });
      const settled = receipt.status === 'success';
      const consistent = settled === (record.outcome === Outcome.Settled);
      return {
        source: 'chain' as const,
        ok: consistent,
        detail: `${short(record.txRef)} in block ${receipt.blockNumber}, ${settled ? 'settled' : 'reverted by the token'}`,
        from: onChain.from,
        call: decode(onChain.input),
        stateBlock: receipt.blockNumber - 1n,
      };
    }
    const held = await archived(record.seq);
    if (!held) return { source: 'bank-archive' as const, ok: false, detail: 'not on-chain and not in the bank archive', from: null, call: null, stateBlock: 0n };
    const hashOk = keccak256(held.raw) === record.txRef;
    const from = await recoverTransactionAddress({ serializedTransaction: held.raw as TransactionSerialized }).catch(() => null);
    const parsed = (() => {
      try {
        return parseTransaction(held.raw);
      } catch {
        return null;
      }
    })();
    return {
      source: 'bank-archive' as const,
      ok: hashOk && !!from && record.outcome === Outcome.Blocked,
      detail: hashOk ? `signed by ${short(from ?? zeroHash)}, stopped by the issuing bank’s node before broadcast` : 'archived bytes do not hash to the recorded reference',
      from,
      call: parsed?.data ? decode(parsed.data) : null,
      stateBlock: BigInt(held.stateBlock),
    };
  }

  private async openEnvelope(envelope: Hex, record: DecisionRecord, check: (id: string, label: string, ok: boolean, detail: string, m?: AuditCheck['mode']) => boolean): Promise<EnvelopePayload | null> {
    let data: EnvelopePayload;
    try {
      data = decryptEnvelope(envelope, this.privateKey, record.from);
    } catch (err) {
      check('decrypt', 'Audit envelope decrypts with the auditor’s key', false, err instanceof EnvelopeError ? err.message : 'malformed envelope', 'data');
      return null;
    }
    check('decrypt', 'Audit envelope decrypts with the auditor’s key', true, 'authenticated to the sending holder', 'data');
    check(
      'envelope-match',
      'Envelope describes this exact transfer',
      getAddress(data.holder) === getAddress(record.from) && getAddress(data.to) === getAddress(record.to) && BigInt(data.amount) === record.amount && BigInt(data.nonce) === record.nonce,
      `nonce ${data.nonce}, policy v${data.policyVersion}`,
      'data',
    );
    return data;
  }

  private async credentialRoot(data: EnvelopePayload): Promise<Hex> {
    const hash = poseidon2From(this.bb);
    const leaf = await credentialLeaf(hash, {
      salt: BigInt(data.salt),
      holder: BigInt(data.holder),
      country: data.country,
      investorClass: data.investorClass,
      expiry: BigInt(data.expiry),
    });
    return fieldHex(await CredentialTree.computeRoot(hash, leaf, data.leafIndex, data.path.map((p) => BigInt(p))));
  }
}

function summarise(mode: AuditMode, record: DecisionRecord, derived: Reason, matches: boolean, integrity: boolean): string {
  if (!integrity) return 'The evidence does not hold together: the record, its anchor or its transaction failed an integrity check.';
  const recorded = REASON_LABEL[record.reason];
  if (mode === 'proof') {
    if (derived === Reason.None) return matches ? 'Settled, and the proof shows the sender satisfied the policy. Nothing about the holder was disclosed.' : 'The public evidence supports settlement, but the record says otherwise.';
    if (!matches) return `The public evidence points to “${REASON_LABEL[derived]}”, which does not match the recorded outcome.`;
    return derived === record.reason
      ? `Blocked for “${recorded}”, confirmed from public evidence alone.`
      : `Blocked, consistent with the record (“${recorded}”). Public evidence shows “${REASON_LABEL[derived]}”; the underlying attribute stays private.`;
  }
  if (derived === Reason.None) return matches ? 'Settled. The disclosed credential satisfies every rule, and the proof attests to it.' : 'The data supports settlement, but the record says otherwise.';
  if (!matches) return `The data points to “${REASON_LABEL[derived]}”, which does not match the recorded outcome.`;
  return derived === record.reason
    ? `Blocked for “${recorded}”, reconstructed from the disclosed credential.`
    : `Blocked, consistent with the record (“${recorded}”). The disclosed data shows why: ${REASON_LABEL[derived].toLowerCase()}.`;
}

const short = (h: string) => (h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h);
const fmt = (units: bigint) => (Number(units) / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 });
