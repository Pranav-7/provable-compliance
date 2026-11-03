/**
 * Contract-level tests. The verifier is replaced by MockVerifier, which accepts a
 * proof iff it commits to the exact public-input vector. That lets these tests
 * check every policy path and, crucially, that the gate assembles public inputs
 * in exactly the order the circuit expects. Real-proof tests live in the
 * end-to-end suite (apps/server/test).
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import {
  BaseError,
  ContractFunctionRevertedError,
  createWalletClient,
  encodeAbiParameters,
  http,
  keccak256,
  pad,
  toHex,
  zeroHash,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hardhat } from 'viem/chains';
import {
  Channel,
  DEV_PRIVATE_KEYS,
  DecisionTree,
  Outcome,
  POLICY_V12,
  Reason,
  decisionLeaf,
  deriveOnChainParams,
  fieldHex,
  policyHash,
  receiveBinding,
  transferBinding,
  type Deployment,
} from '@pc/shared';
import { abi, clients, deployAll, startLocalChain } from '../lib/index';

const PORT = 8645;
const params = deriveOnChainParams(POLICY_V12);
const [, ALICE_KEY, BOB_KEY, CAROL_KEY] = DEV_PRIVATE_KEYS;
const wallet = (key: Hex) => createWalletClient({ chain: hardhat, transport: http(`http://127.0.0.1:${PORT}`), account: privateKeyToAccount(key) });

const mockProof = (inputs: Hex[]): Hex =>
  encodeAbiParameters([{ type: 'bytes32' }], [keccak256(encodeAbiParameters([{ type: 'bytes32[]' }], [inputs]))]);

function revertName(err: unknown): string | undefined {
  if (err instanceof BaseError) {
    const inner = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (inner instanceof ContractFunctionRevertedError) return inner.data?.errorName;
  }
  return undefined;
}

describe('compliance contracts', () => {
  let chain: { url: string; process: ChildProcess };
  let d: Deployment;
  let c: ReturnType<typeof clients>;
  let snapshot: Hex;
  const alice = wallet(ALICE_KEY);
  const bob = wallet(BOB_KEY);
  const carol = wallet(CAROL_KEY);

  const read = (address: Address, name: Parameters<typeof abi>[0], functionName: string, args: unknown[] = []) =>
    c.publicClient.readContract({ address, abi: abi(name), functionName, args }) as Promise<any>;

  async function send(w: ReturnType<typeof wallet> | typeof c.issuer, address: Address, name: Parameters<typeof abi>[0], functionName: string, args: readonly unknown[]) {
    // Simulate first so reverts surface as typed errors.
    const { request } = await c.publicClient.simulateContract({ address, abi: abi(name), functionName, args, account: w.account! });
    const hash = await w.writeContract(request as any);
    const receipt = await c.publicClient.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, 'success');
    return receipt;
  }

  async function now(): Promise<bigint> {
    return (await c.publicClient.getBlock()).timestamp;
  }

  async function publicInputsFor(holder: Address, validAt: bigint, binding: Hex): Promise<Hex[]> {
    return read(d.contracts.complianceGate, 'ComplianceGate', 'publicInputs', [holder, validAt, binding]);
  }

  async function registerPass(w: ReturnType<typeof wallet>) {
    const holder = w.account.address;
    const epoch = (await read(d.contracts.credentialRegistry, 'CredentialRegistry', 'epoch')) as bigint;
    const root = (await read(d.contracts.credentialRegistry, 'CredentialRegistry', 'root')) as Hex;
    const validAt = await now();
    const binding = receiveBinding({ chainId: d.chainId, gate: d.contracts.complianceGate, holder, epoch });
    const inputs = await publicInputsFor(holder, validAt, binding);
    return send(w, d.contracts.complianceGate, 'ComplianceGate', 'registerReceivePass', [root, validAt, mockProof(inputs)]);
  }

  const ENVELOPE = '0x01aabbcc' as Hex;

  async function transferArgs(from: ReturnType<typeof wallet>, to: Address, amount: bigint, envelope: Hex = ENVELOPE) {
    const nonce = (await read(d.contracts.complianceGate, 'ComplianceGate', 'transferNonce', [from.account.address])) as bigint;
    const root = (await read(d.contracts.credentialRegistry, 'CredentialRegistry', 'root')) as Hex;
    const validAt = await now();
    const binding = transferBinding({
      chainId: d.chainId,
      token: d.contracts.token,
      from: from.account.address,
      to,
      amount,
      nonce,
      envelopeHash: keccak256(envelope),
    });
    const inputs = await publicInputsFor(from.account.address, validAt, binding);
    return [to, amount, root, validAt, mockProof(inputs), envelope] as const;
  }

  before(async () => {
    chain = await startLocalChain(PORT);
    d = await deployAll(chain.url, { verifier: 'mock' });
    c = clients(chain.url);
    await send(c.issuer, d.contracts.policyRegistry, 'PolicyRegistry', 'publish', [
      12,
      policyHash(POLICY_V12),
      params.allowedCountries,
      params.allowedClassMask,
      params.maxHolderBalance,
      params.effectiveFrom,
    ]);
    await send(c.issuer, d.contracts.credentialRegistry, 'CredentialRegistry', 'updateRoot', [fieldHex(1234n), 'initial issuance']);
    snapshot = (await c.publicClient.request({ method: 'evm_snapshot' as any })) as Hex;
  });

  beforeEach(async () => {
    await c.publicClient.request({ method: 'evm_revert' as any, params: [snapshot] as any });
    snapshot = (await c.publicClient.request({ method: 'evm_snapshot' as any })) as Hex;
  });

  after(() => {
    chain?.process.kill();
  });

  test('gate assembles public inputs in circuit order', async () => {
    const validAt = 1_800_000_000n;
    const inputs = await publicInputsFor(alice.account.address, validAt, fieldHex(99n));
    assert.deepEqual(inputs, [
      fieldHex(1234n),
      ...params.allowedCountries.map((x) => fieldHex(BigInt(x))),
      fieldHex(BigInt(params.allowedClassMask)),
      fieldHex(validAt),
      pad(alice.account.address.toLowerCase() as Hex, { size: 32 }),
      fieldHex(99n),
    ]);
  });

  test('bindings computed off-chain match the contract', async () => {
    const args = {
      chainId: d.chainId,
      token: d.contracts.token,
      from: alice.account.address,
      to: bob.account.address,
      amount: 500n,
      nonce: 3n,
      envelopeHash: keccak256(ENVELOPE),
    };
    assert.equal(
      transferBinding(args),
      await read(d.contracts.complianceGate, 'ComplianceGate', 'transferBinding', [args.from, args.to, args.amount, args.nonce, args.envelopeHash]),
    );
    const r = { chainId: d.chainId, gate: d.contracts.complianceGate, holder: bob.account.address, epoch: 7n };
    assert.equal(receiveBinding(r), await read(d.contracts.complianceGate, 'ComplianceGate', 'receiveBinding', [r.holder, r.epoch]));
  });

  test('policy versions are append-only and issuer-controlled', async () => {
    await assert.rejects(
      send(c.issuer, d.contracts.policyRegistry, 'PolicyRegistry', 'publish', [12, policyHash(POLICY_V12), params.allowedCountries, 12, 1n, 0n]),
      (e) => revertName(e) === 'VersionNotIncreasing',
    );
    await assert.rejects(
      send(alice, d.contracts.policyRegistry, 'PolicyRegistry', 'publish', [13, policyHash(POLICY_V12), params.allowedCountries, 12, 1n, 0n]),
      (e) => revertName(e) === 'OwnableUnauthorizedAccount',
    );
    const active = await read(d.contracts.policyRegistry, 'PolicyRegistry', 'active');
    assert.equal(active.documentHash, policyHash(POLICY_V12));
  });

  test('issuance requires a current receive pass', async () => {
    await assert.rejects(send(c.issuer, d.contracts.token, 'CompliantToken', 'issue', [alice.account.address, 1000n]), (e) => revertName(e) === 'RecipientNotEligible');
    await registerPass(alice);
    await send(c.issuer, d.contracts.token, 'CompliantToken', 'issue', [alice.account.address, 1000n]);
    assert.equal(await read(d.contracts.token, 'CompliantToken', 'balanceOf', [alice.account.address]), 1000n);
  });

  test('a compliant transfer settles; plain ERC-20 transfers are closed', async () => {
    await registerPass(alice);
    await registerPass(bob);
    await send(c.issuer, d.contracts.token, 'CompliantToken', 'issue', [alice.account.address, 10_000n]);

    await assert.rejects(send(alice, d.contracts.token, 'CompliantToken', 'transfer', [bob.account.address, 1n]), (e) => revertName(e) === 'ProofRequired');

    await send(alice, d.contracts.token, 'CompliantToken', 'transferWithProof', await transferArgs(alice, bob.account.address, 2_500n));
    assert.equal(await read(d.contracts.token, 'CompliantToken', 'balanceOf', [bob.account.address]), 2_500n);
  });

  test('a proof cannot be replayed or redirected', async () => {
    await registerPass(alice);
    await registerPass(bob);
    await registerPass(carol);
    await send(c.issuer, d.contracts.token, 'CompliantToken', 'issue', [alice.account.address, 10_000n]);
    const args = await transferArgs(alice, bob.account.address, 100n);
    await send(alice, d.contracts.token, 'CompliantToken', 'transferWithProof', args);
    await assert.rejects(send(alice, d.contracts.token, 'CompliantToken', 'transferWithProof', args), (e) => revertName(e) === 'InvalidProof');
    const redirected = [carol.account.address, ...args.slice(1)] as const;
    await assert.rejects(send(alice, d.contracts.token, 'CompliantToken', 'transferWithProof', redirected), (e) => revertName(e) === 'InvalidProof');
  });

  test('the audit envelope is required and bound into the proof', async () => {
    await registerPass(alice);
    await registerPass(bob);
    await send(c.issuer, d.contracts.token, 'CompliantToken', 'issue', [alice.account.address, 10_000n]);
    const args = await transferArgs(alice, bob.account.address, 100n);
    const swapped = [...args.slice(0, 5), '0x01deadbeef'] as const;
    await assert.rejects(send(alice, d.contracts.token, 'CompliantToken', 'transferWithProof', swapped), (e) => revertName(e) === 'InvalidProof');
    const missing = [...args.slice(0, 5), '0x'] as const;
    await assert.rejects(send(alice, d.contracts.token, 'CompliantToken', 'transferWithProof', missing), (e) => revertName(e) === 'AuditEnvelopeRequired');
    await send(alice, d.contracts.token, 'CompliantToken', 'transferWithProof', args);
  });

  test('auditors can rebuild public inputs for a superseded root and past policy version', async () => {
    const inputs = (await read(d.contracts.complianceGate, 'ComplianceGate', 'publicInputsFor', [
      fieldHex(42n),
      12,
      alice.account.address,
      1_800_000_000n,
      fieldHex(7n),
    ])) as Hex[];
    assert.equal(inputs[0], fieldHex(42n));
    assert.equal(inputs[8], fieldHex(7n));
  });

  test('recipient without a pass is refused', async () => {
    await registerPass(alice);
    await send(c.issuer, d.contracts.token, 'CompliantToken', 'issue', [alice.account.address, 10_000n]);
    await assert.rejects(
      send(alice, d.contracts.token, 'CompliantToken', 'transferWithProof', await transferArgs(alice, carol.account.address, 1n)),
      (e) => revertName(e) === 'RecipientNotEligible',
    );
  });

  test('balance cap is enforced on the recipient', async () => {
    await registerPass(alice);
    await registerPass(bob);
    await send(c.issuer, d.contracts.token, 'CompliantToken', 'issue', [alice.account.address, params.maxHolderBalance]);
    await send(c.issuer, d.contracts.token, 'CompliantToken', 'issue', [bob.account.address, params.maxHolderBalance - 10n]);
    await assert.rejects(
      send(alice, d.contracts.token, 'CompliantToken', 'transferWithProof', await transferArgs(alice, bob.account.address, 11n)),
      (e) => revertName(e) === 'MaxBalanceExceeded',
    );
  });

  test('registry update invalidates stale proofs and lapses passes', async () => {
    await registerPass(alice);
    await registerPass(bob);
    await send(c.issuer, d.contracts.token, 'CompliantToken', 'issue', [alice.account.address, 10_000n]);
    const stale = await transferArgs(alice, bob.account.address, 100n);

    await send(c.issuer, d.contracts.credentialRegistry, 'CredentialRegistry', 'updateRoot', [fieldHex(5678n), 'revocation']);
    assert.equal(await read(d.contracts.complianceGate, 'ComplianceGate', 'hasReceivePass', [bob.account.address]), false);
    await assert.rejects(send(alice, d.contracts.token, 'CompliantToken', 'transferWithProof', stale), (e) => revertName(e) === 'StaleRegistryRoot');
  });

  test('old proof timestamps are refused', async () => {
    await registerPass(alice);
    await registerPass(bob);
    await send(c.issuer, d.contracts.token, 'CompliantToken', 'issue', [alice.account.address, 10_000n]);
    const args = await transferArgs(alice, bob.account.address, 100n);
    await c.publicClient.request({ method: 'evm_increaseTime' as any, params: [7200] as any });
    await c.publicClient.request({ method: 'evm_mine' as any });
    await assert.rejects(send(alice, d.contracts.token, 'CompliantToken', 'transferWithProof', args), (e) => revertName(e) === 'ProofTimestampOutOfRange');
  });

  test('anchored decision log proves single records without revealing others', async () => {
    const records = Array.from({ length: 7 }, (_, i) => ({
      seq: i,
      timestamp: 1_800_000_000 + i,
      channel: i % 2 ? Channel.Direct : Channel.CompliantNode,
      from: alice.account.address,
      to: bob.account.address,
      amount: BigInt(100 * (i + 1)),
      outcome: i === 4 ? Outcome.Blocked : Outcome.Settled,
      reason: i === 4 ? Reason.Sanctioned : Reason.None,
      policyVersion: 12,
      policyHash: policyHash(POLICY_V12),
      registryRoot: fieldHex(1234n),
      proofHash: keccak256(toHex(i)),
      envelopeHash: zeroHash,
      nonce: BigInt(i),
      txRef: zeroHash,
    }));
    const leaves = records.map(decisionLeaf);
    const tree = new DecisionTree(leaves);
    await send(c.issuer, d.contracts.decisionLogAnchor, 'DecisionLogAnchor', 'anchor', [tree.root, 0, leaves.length]);
    for (let i = 0; i < leaves.length; i++) {
      assert.equal(await read(d.contracts.decisionLogAnchor, 'DecisionLogAnchor', 'verifyRecord', [0n, leaves[i], tree.proof(i).siblings]), true);
    }
    const tampered = decisionLeaf({ ...records[4], outcome: Outcome.Settled, reason: Reason.None });
    assert.equal(await read(d.contracts.decisionLogAnchor, 'DecisionLogAnchor', 'verifyRecord', [0n, tampered, tree.proof(4).siblings]), false);
  });
});
