import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Barretenberg } from '@aztec/bb.js';
import {
  CredentialTree,
  credentialLeaf,
  deriveOnChainParams,
  fieldHex,
  INVESTOR_CLASS,
  ISO_NUMERIC,
  POLICY_V12,
  type CredentialAttributes,
} from '@pc/shared';
import { EligibilityProver, UnprovableStatementError, poseidon2From, type EligibilityPublicInputs } from '../src/index';

const NOW = 1_800_000_000n;
const ALICE = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const;
const params = deriveOnChainParams(POLICY_V12);

describe('eligibility circuit', () => {
  let bb: Barretenberg;
  let prover: EligibilityProver;
  let tree: CredentialTree;
  let alice: CredentialAttributes;
  let pub: EligibilityPublicInputs;

  before(async () => {
    bb = await Barretenberg.new({ skipSrsInit: true });
    prover = await EligibilityProver.create(bb);
    const hash = poseidon2From(bb);
    tree = await CredentialTree.create(hash);
    alice = { salt: 123456789n, holder: BigInt(ALICE), country: ISO_NUMERIC.CH, investorClass: INVESTOR_CLASS.professional, expiry: NOW + 86_400n };
    await tree.set(5, await credentialLeaf(hash, alice));
    await tree.set(9, await credentialLeaf(hash, { ...alice, salt: 1n, holder: 42n }));
    pub = {
      registryRoot: tree.root,
      allowedCountries: params.allowedCountries,
      allowedClassMask: params.allowedClassMask,
      now: NOW,
      holder: ALICE,
      binding: fieldHex(777n),
    };
  });

  after(async () => bb.destroy());

  test('TypeScript tree and circuit agree on the root', async () => {
    const w = tree.witness(5);
    const recomputed = await CredentialTree.computeRoot(poseidon2From(bb), tree.leafAt(5), 5, w.path);
    assert.equal(recomputed, tree.root);
    await prover.witness({ credential: alice, membership: w }, pub);
  });

  const expectUnprovable = async (fn: () => Promise<unknown>, reason: string) => {
    await assert.rejects(fn, (e: unknown) => e instanceof UnprovableStatementError && e.reason === reason);
  };

  test('revoked credential cannot be proven against the new root', async () => {
    const before = tree.witness(5);
    await tree.clear(5);
    await expectUnprovable(() => prover.witness({ credential: alice, membership: before }, { ...pub, registryRoot: tree.root }), 'credential not in registry');
    await tree.set(5, await credentialLeaf(poseidon2From(bb), alice));
  });

  test('disallowed jurisdiction is rejected', async () => {
    await expectUnprovable(
      () => prover.witness({ credential: alice, membership: tree.witness(5) }, { ...pub, allowedCountries: [ISO_NUMERIC.SG, 0, 0, 0] }),
      'jurisdiction not permitted',
    );
  });

  test('disallowed investor class is rejected', async () => {
    await expectUnprovable(
      () => prover.witness({ credential: alice, membership: tree.witness(5) }, { ...pub, allowedClassMask: 1 << INVESTOR_CLASS.institutional }),
      'investor class not permitted',
    );
  });

  test('expired credential is rejected', async () => {
    await expectUnprovable(() => prover.witness({ credential: alice, membership: tree.witness(5) }, { ...pub, now: alice.expiry }), 'credential expired');
  });

  test('credential is bound to its holder', async () => {
    await expectUnprovable(
      () => prover.witness({ credential: alice, membership: tree.witness(5) }, { ...pub, holder: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' }),
      'credential not in registry',
    );
  });

  test('tampered attributes do not match the committed leaf', async () => {
    await expectUnprovable(
      () => prover.witness({ credential: { ...alice, investorClass: INVESTOR_CLASS.institutional }, membership: tree.witness(5) }, pub),
      'credential not in registry',
    );
  });

  test('generates and verifies a real UltraHonk proof', { skip: process.env.SKIP_PROVING === '1' && 'SKIP_PROVING=1 (no CRS available)' }, async () => {
    const proverBb = await Barretenberg.new();
    const full = await EligibilityProver.create(proverBb);
    try {
      const proof = await full.prove({ credential: alice, membership: tree.witness(5) }, pub);
      assert.equal(proof.publicInputs.length, 9);
      assert.equal(BigInt(proof.publicInputs[0]), tree.root);
      assert.equal(await full.verify(proof), true);
      const forged = { ...proof, publicInputs: proof.publicInputs.map((x, i) => (i === 8 ? fieldHex(778n) : x)) };
      assert.equal(await full.verify(forged), false);
    } finally {
      await full.destroy();
    }
  });
});
