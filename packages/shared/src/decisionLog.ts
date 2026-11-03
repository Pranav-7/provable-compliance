import { concat, encodeAbiParameters, keccak256, type Address, type Hex } from 'viem';

export enum Channel {
  CompliantNode = 0,
  Direct = 1,
}

export enum Outcome {
  Settled = 0,
  Blocked = 1,
}

/** Why a decision was taken. Shared by the bank service, the UI and the audit trail. */
export enum Reason {
  None = 0,
  Sanctioned = 1,
  InvestorClass = 2,
  Jurisdiction = 3,
  CredentialExpired = 4,
  RecipientNotEligible = 5,
  MaxBalance = 6,
  StaleRegistryRoot = 7,
  InvalidProof = 8,
  NoCredential = 9,
  ProofRequired = 10,
  Other = 11,
  AuditEnvelopeMissing = 12,
}

export const REASON_LABEL: Record<Reason, string> = {
  [Reason.None]: 'Compliant',
  [Reason.Sanctioned]: 'Holder sanctioned',
  [Reason.InvestorClass]: 'Investor class not permitted',
  [Reason.Jurisdiction]: 'Jurisdiction not permitted',
  [Reason.CredentialExpired]: 'Credential expired',
  [Reason.RecipientNotEligible]: 'Recipient not eligible',
  [Reason.MaxBalance]: 'Recipient balance cap exceeded',
  [Reason.StaleRegistryRoot]: 'Proof built against a superseded registry root',
  [Reason.InvalidProof]: 'Proof rejected by verifier',
  [Reason.NoCredential]: 'No valid credential',
  [Reason.ProofRequired]: 'Plain transfer without proof',
  [Reason.Other]: 'Rejected',
  [Reason.AuditEnvelopeMissing]: 'Audit envelope missing',
};

/** One compliance decision, exactly as it is committed to the audit tree. */
export interface DecisionRecord {
  seq: number;
  timestamp: number;
  channel: Channel;
  from: Address;
  to: Address;
  amount: bigint;
  outcome: Outcome;
  reason: Reason;
  policyVersion: number;
  policyHash: Hex;
  registryRoot: Hex;
  proofHash: Hex;
  /** keccak-256 of the audit envelope carried by the transfer (zero if none). */
  envelopeHash: Hex;
  /** Sender's transfer nonce the proof was bound to. */
  nonce: bigint;
  txRef: Hex;
}

const RECORD_ABI = [
  { type: 'uint32' },
  { type: 'uint64' },
  { type: 'uint8' },
  { type: 'address' },
  { type: 'address' },
  { type: 'uint256' },
  { type: 'uint8' },
  { type: 'uint8' },
  { type: 'uint32' },
  { type: 'bytes32' },
  { type: 'bytes32' },
  { type: 'bytes32' },
  { type: 'bytes32' },
  { type: 'uint256' },
  { type: 'bytes32' },
] as const;

/** Leaf = keccak256(keccak256(abi.encode(record))), the OpenZeppelin StandardMerkleTree convention. */
export function decisionLeaf(r: DecisionRecord): Hex {
  const encoded = encodeAbiParameters(RECORD_ABI, [
    r.seq,
    BigInt(r.timestamp),
    r.channel,
    r.from,
    r.to,
    r.amount,
    r.outcome,
    r.reason,
    r.policyVersion,
    r.policyHash,
    r.registryRoot,
    r.proofHash,
    r.envelopeHash,
    r.nonce,
    r.txRef,
  ]);
  return keccak256(keccak256(encoded));
}

/** Commutative pair hash used by OpenZeppelin's MerkleProof (sorted children). */
export function hashPair(a: Hex, b: Hex): Hex {
  return BigInt(a) < BigInt(b) ? keccak256(concat([a, b])) : keccak256(concat([b, a]));
}

/**
 * Binary Merkle tree over decision leaves in log order. An unpaired node at the
 * end of a level is promoted unchanged, so proofs simply omit that level.
 * `levels` is exposed so the UI can animate the tree being built.
 */
export class DecisionTree {
  readonly levels: Hex[][];

  constructor(leaves: Hex[]) {
    if (leaves.length === 0) throw new Error('Cannot build a tree with no leaves');
    const levels: Hex[][] = [leaves.slice()];
    while (levels[levels.length - 1].length > 1) {
      const below = levels[levels.length - 1];
      const next: Hex[] = [];
      for (let i = 0; i < below.length; i += 2) {
        next.push(i + 1 < below.length ? hashPair(below[i], below[i + 1]) : below[i]);
      }
      levels.push(next);
    }
    this.levels = levels;
  }

  get root(): Hex {
    return this.levels[this.levels.length - 1][0];
  }

  /** Sibling path for the leaf at `index`, plus the node indices it touches (for highlighting). */
  proof(index: number): { siblings: Hex[]; pathIndices: number[] } {
    const siblings: Hex[] = [];
    const pathIndices: number[] = [];
    let i = index;
    for (let level = 0; level < this.levels.length - 1; level++) {
      pathIndices.push(i);
      const sibling = i ^ 1;
      if (sibling < this.levels[level].length) siblings.push(this.levels[level][sibling]);
      i >>= 1;
    }
    pathIndices.push(0);
    return { siblings, pathIndices };
  }

  static verify(leaf: Hex, siblings: Hex[], root: Hex): boolean {
    return siblings.reduce((node, s) => hashPair(node, s), leaf).toLowerCase() === root.toLowerCase();
  }
}
