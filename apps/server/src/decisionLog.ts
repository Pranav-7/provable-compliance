import { zeroHash, type Address, type Hex } from 'viem';
import {
  DecisionTree,
  decisionLeaf,
  type AnchoredBatch,
  type AuditRecordProof,
  type DecisionDTO,
  type DecisionRecord,
  type HolderId,
} from '@pc/shared';
import type { Chain } from './chain';

interface StoredDecision {
  record: DecisionRecord;
  leaf: Hex;
  batchId: number | null;
  fromId?: HolderId;
  toId?: HolderId;
}

export type NewDecision = Omit<DecisionRecord, 'seq' | 'timestamp'> & { fromId?: HolderId; toId?: HolderId };

/**
 * Append-only log of every compliance decision the bank observes or takes,
 * including blocked attempts. Batches are committed to a Merkle tree whose root
 * is anchored on-chain; any record can later be proven to an auditor in isolation.
 */
export class DecisionLog {
  private decisions: StoredDecision[] = [];
  private batches: AnchoredBatch[] = [];
  private batchLeaves = new Map<number, Hex[]>();
  /** Raw signed transactions the bank's node blocked before broadcast, keyed by decision seq. */
  private archive = new Map<number, { raw: Hex; stateBlock: bigint }>();

  constructor(private readonly chain: Chain) {}

  reset(): void {
    this.decisions = [];
    this.batches = [];
    this.batchLeaves.clear();
    this.archive.clear();
  }

  /**
   * Keeps the raw transaction behind a node-blocked decision. The record's txRef
   * is its hash, so an auditor can check the archived bytes are exactly the ones
   * the decision was taken on. `stateBlock` is the chain head the node screened
   * against, so the auditor can replay the same public state.
   */
  archiveRawTx(seq: number, raw: Hex, stateBlock: bigint): void {
    this.archive.set(seq, { raw, stateBlock });
  }

  rawTx(seq: number): { raw: Hex; stateBlock: bigint } | undefined {
    return this.archive.get(seq);
  }

  append(d: NewDecision): DecisionDTO {
    const { fromId, toId, ...rest } = d;
    const record: DecisionRecord = { ...rest, seq: this.decisions.length, timestamp: Math.floor(Date.now() / 1000) };
    const stored: StoredDecision = { record, leaf: decisionLeaf(record), batchId: null, fromId, toId };
    this.decisions.push(stored);
    return toDTO(stored);
  }

  list(): DecisionDTO[] {
    return this.decisions.map(toDTO);
  }

  listBatches(): AnchoredBatch[] {
    return [...this.batches];
  }

  get pendingCount(): number {
    return this.decisions.filter((d) => d.batchId === null).length;
  }

  /** Commits every not-yet-anchored decision as one batch and anchors its root on-chain. */
  async anchorPending(): Promise<{ batch: AnchoredBatch; levels: Hex[][] }> {
    const pending = this.decisions.filter((d) => d.batchId === null);
    if (pending.length === 0) throw new Error('No new decisions to anchor');
    const leaves = pending.map((d) => d.leaf);
    const tree = new DecisionTree(leaves);
    const firstSeq = pending[0].record.seq;
    const receipt = await this.chain.write(this.chain.addresses.decisionLogAnchor, 'DecisionLogAnchor', 'anchor', [tree.root, firstSeq, leaves.length]);
    const batchId = this.batches.length;
    const block = await this.chain.publicClient.getBlock({ blockNumber: receipt.blockNumber });
    const batch: AnchoredBatch = {
      batchId,
      root: tree.root,
      firstSeq,
      count: leaves.length,
      txHash: receipt.transactionHash,
      blockNumber: Number(receipt.blockNumber),
      anchoredAt: Number(block.timestamp),
    };
    for (const d of pending) d.batchId = batchId;
    this.batches.push(batch);
    this.batchLeaves.set(batchId, leaves);
    return { batch, levels: tree.levels };
  }

  /** Inclusion proof for one record: everything an auditor needs, and nothing more. */
  proofFor(seq: number): AuditRecordProof {
    const stored = this.decisions[seq];
    if (!stored) throw new Error(`Unknown decision #${seq}`);
    if (stored.batchId === null) throw new Error(`Decision #${seq} has not been anchored yet`);
    const batch = this.batches[stored.batchId];
    const leaves = this.batchLeaves.get(stored.batchId)!;
    const tree = new DecisionTree(leaves);
    const { siblings, pathIndices } = tree.proof(seq - batch.firstSeq);
    return { record: toDTO(stored), leaf: stored.leaf, batch, siblings, pathIndices, levels: tree.levels };
  }

  /** Leaf hashes of a batch, so the auditor can see its shape without seeing its content. */
  batchShape(batchId: number): { batch: AnchoredBatch; levels: Hex[][] } {
    const batch = this.batches[batchId];
    if (!batch) throw new Error(`Unknown batch ${batchId}`);
    return { batch, levels: new DecisionTree(this.batchLeaves.get(batchId)!).levels };
  }
}

function toDTO(s: StoredDecision): DecisionDTO {
  const r = s.record;
  return {
    seq: r.seq,
    timestamp: r.timestamp,
    channel: r.channel,
    from: r.from,
    to: r.to,
    fromId: s.fromId,
    toId: s.toId,
    amount: r.amount.toString(),
    outcome: r.outcome,
    reason: r.reason,
    policyVersion: r.policyVersion,
    policyHash: r.policyHash,
    registryRoot: r.registryRoot,
    proofHash: r.proofHash,
    envelopeHash: r.envelopeHash,
    nonce: r.nonce.toString(),
    txRef: r.txRef,
    leaf: s.leaf,
    batchId: s.batchId,
  };
}

export const ZERO: Hex = zeroHash;
export type { Address };
