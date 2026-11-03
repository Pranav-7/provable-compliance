import type { Address, Hex } from 'viem';
import type { HolderId } from './cast';
import type { CaseId, Route } from './cases';
import type { Channel, Outcome, Reason } from './decisionLog';

/** JSON-safe decision record (bigints serialised as decimal strings). */
export interface DecisionDTO {
  seq: number;
  timestamp: number;
  channel: Channel;
  from: Address;
  to: Address;
  fromId?: HolderId;
  toId?: HolderId;
  amount: string;
  outcome: Outcome;
  reason: Reason;
  policyVersion: number;
  policyHash: Hex;
  registryRoot: Hex;
  proofHash: Hex;
  envelopeHash: Hex;
  nonce: string;
  txRef: Hex;
  leaf: Hex;
  batchId: number | null;
}

export interface Deployment {
  caseId: CaseId;
  chainId: number;
  rpcUrl: string;
  deployer: Address;
  contracts: {
    policyRegistry: Address;
    credentialRegistry: Address;
    complianceGate: Address;
    token: Address;
    decisionLogAnchor: Address;
    verifier: Address;
  };
  deployedAt: number;
}

export interface PolicyState {
  version: number;
  documentHash: Hex;
  allowedCountries: number[];
  allowedClassMask: number;
  maxHolderBalance: string;
  effectiveFrom: number;
  publishedAt: number;
  txHash: Hex;
  blockNumber: number;
}

export interface RegistryMember {
  holderId: HolderId;
  leafIndex: number;
  leaf: Hex;
  status: 'active' | 'revoked';
}

export interface RegistryState {
  root: Hex;
  epoch: number;
  members: RegistryMember[];
  lastTxHash: Hex | null;
  lastReason: string | null;
}

export interface AnchoredBatch {
  batchId: number;
  root: Hex;
  firstSeq: number;
  count: number;
  txHash: Hex;
  blockNumber: number;
  anchoredAt: number;
}

export interface BankState {
  deployment: Deployment;
  policy: PolicyState | null;
  registry: RegistryState | null;
  decisions: DecisionDTO[];
  batches: AnchoredBatch[];
}

export interface AuditRecordProof {
  record: DecisionDTO;
  leaf: Hex;
  batch: AnchoredBatch;
  siblings: Hex[];
  pathIndices: number[];
  levels: Hex[][];
}

export interface CredentialSummary {
  country: string;
  countryNumeric: number;
  investorClass: string;
  expiry: number;
  leafIndex: number;
}

export interface HolderView {
  id: HolderId;
  name: string;
  role: string;
  address: Address;
  balance: string;
  hasReceivePass: boolean;
  credential: CredentialSummary | null;
  credentialStatus: 'none' | 'active' | 'revoked';
}


/** Proof as presented to the user: what was proven, and what the chain actually sees. */
export interface ProofArtifact {
  proofHex: Hex;
  proofBytes: number;
  provingMs: number;
  publicInputs: { label: string; value: string }[];
  registryRoot: Hex;
  validAt: number;
  /** Audit envelope carried with a transfer: encrypted to the auditor, hash bound into the proof. */
  envelope: { hash: Hex; bytes: number } | null;
}

export interface ActionResult {
  ok: boolean;
  stage: 'prove' | 'submit' | 'settle';
  route: Route | null;
  message: string;
  reason: Reason;
  proof: ProofArtifact | null;
  txHash: Hex | null;
  gasUsed: string | null;
  blockNumber: number | null;
}

export type BankEvent =
  | { type: 'decision'; decision: DecisionDTO }
  | { type: 'registry'; registry: RegistryState }
  | { type: 'policy'; policy: PolicyState }
  | { type: 'anchor'; batch: AnchoredBatch }
  | { type: 'reset' };

export interface OutcomeLabel {
  outcome: Outcome;
  reason: Reason;
}

/** One check performed by the independent auditor. */
export interface AuditCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  mode: 'proof' | 'data';
}

export interface AuditReport {
  caseId: CaseId;
  seq: number;
  mode: 'proof' | 'proof+data';
  recordedOutcome: { outcome: Outcome; reason: Reason };
  /** Where the transaction bytes came from: the chain itself, or the bank's archive (never broadcast). */
  source: 'chain' | 'bank-archive';
  checks: AuditCheck[];
  disclosed: null | {
    holder: Address;
    country: string;
    investorClass: string;
    expiry: number;
    leafIndex: number;
  };
  /** The auditor's own conclusion from the evidence. */
  conclusion: { outcome: Outcome; reason: Reason; matchesRecord: boolean; summary: string };
}
