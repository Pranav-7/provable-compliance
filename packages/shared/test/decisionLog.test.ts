import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zeroHash } from 'viem';
import { Channel, DecisionTree, Outcome, Reason, decisionLeaf, type DecisionRecord } from '../src/index';

const record = (seq: number, overrides: Partial<DecisionRecord> = {}): DecisionRecord => ({
  seq,
  timestamp: 1_790_000_000 + seq,
  channel: Channel.CompliantNode,
  from: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  to: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  amount: 50_000n,
  outcome: Outcome.Settled,
  reason: Reason.None,
  policyVersion: 12,
  policyHash: zeroHash,
  registryRoot: zeroHash,
  proofHash: zeroHash,
  envelopeHash: zeroHash,
  nonce: 0n,
  txRef: zeroHash,
  ...overrides,
});

test('every leaf proves into the root, for every tree size', () => {
  for (let n = 1; n <= 17; n++) {
    const leaves = Array.from({ length: n }, (_, i) => decisionLeaf(record(i)));
    const tree = new DecisionTree(leaves);
    leaves.forEach((leaf, i) => assert.ok(DecisionTree.verify(leaf, tree.proof(i).siblings, tree.root), `n=${n} i=${i}`));
  }
});

test('tampering with any field breaks verification', () => {
  const records = Array.from({ length: 8 }, (_, i) => record(i));
  const tree = new DecisionTree(records.map(decisionLeaf));
  const tampered = decisionLeaf({ ...records[3], outcome: Outcome.Blocked, reason: Reason.Sanctioned });
  assert.equal(DecisionTree.verify(tampered, tree.proof(3).siblings, tree.root), false);
});

test('a proof for one leaf does not verify another', () => {
  const leaves = Array.from({ length: 6 }, (_, i) => decisionLeaf(record(i)));
  const tree = new DecisionTree(leaves);
  assert.equal(DecisionTree.verify(leaves[1], tree.proof(2).siblings, tree.root), false);
});
