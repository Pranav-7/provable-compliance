/**
 * End-to-end: chain, contracts, bank service, holder wallets and the independent
 * auditor running together, driven through exactly the story the demo UI tells,
 * once for each case study (client transfers and interbank settlement).
 *
 *   PROOF_SYSTEM=ultrahonk (default)  real UltraHonk proofs verified by HonkVerifier
 *   PROOF_SYSTEM=dev                  circuit still executed; MockVerifier on-chain
 *                                     (for CI machines without the public trusted setup)
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import { deployAll, startLocalChain, abi } from '@pc/contracts';
import { createPublicClient, http, type Hex } from 'viem';
import { hardhat } from 'viem/chains';
import {
  CASES,
  Channel,
  DecisionTree,
  HOLDERS,
  Outcome,
  Reason,
  decisionLeaf,
  type ActionResult,
  type AuditRecordProof,
  type AuditReport,
  type BankState,
  type CaseConfig,
  type DecisionDTO,
  type Deployment,
  type HolderView,
} from '@pc/shared';
import { createBank } from '../src/app';
import { createWalletService } from '../../wallet/src/app';
import { DevProofSystem, UltraHonkProofSystem } from '../../wallet/src/proofSystem';
import { createAuditorService } from '../../auditor/src/app';

const dev = process.env.PROOF_SYSTEM === 'dev';
const AUDITOR_KEY: Hex = '0x8f46a2230a493a78a55b95a6efd2165d89a24aabad224e025fcd32e9db11d6b3';
const PORTS = {
  client: { chain: 8655, bank: 8797, wallet: 8798 },
  interbank: { chain: 8656, bank: 8799, wallet: 8800 },
  auditor: 8801,
} as const;
const AUDITOR = `http://127.0.0.1:${PORTS.auditor}`;

async function call<T>(base: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${json.error}`);
  return json as T;
}

const TRADING_DAY_REASONS = [
  Reason.None,
  Reason.None,
  Reason.InvestorClass,
  Reason.Sanctioned,
  Reason.MaxBalance,
  Reason.None,
  Reason.StaleRegistryRoot,
  Reason.RecipientNotEligible,
  Reason.RecipientNotEligible,
  Reason.None,
  Reason.None,
  Reason.InvalidProof,
];

const display = (amount: string) => Number(amount).toLocaleString('en-GB', { minimumFractionDigits: 2 });

function caseStudy(study: CaseConfig) {
  const ports = PORTS[study.id];
  const BANK = `http://127.0.0.1:${ports.bank}`;
  const WALLET = `http://127.0.0.1:${ports.wallet}`;
  const { sender, receiver, sanctioned, ineligible } = study.roles;
  const transfer = (from: string, to: string, amount: string, route: 'compliant-node' | 'direct', mode: 'fresh' | 'stale' | 'forged' = 'fresh') =>
    call<ActionResult>(WALLET, '/api/wallet/transfer', { from, to, amount, route, mode });

  describe(`Case ${study.index}, ${study.title} (${dev ? 'dev proofs' : 'UltraHonk proofs'})`, { timeout: 900_000 }, () => {
    let chain: { url: string; process: ChildProcess };
    let bank: FastifyInstance;
    let wallet: FastifyInstance;
    let auditor: FastifyInstance;
    let deployment: Deployment;

    const holders = async () => (await call<{ holders: HolderView[] }>(WALLET, '/api/wallet/holders')).holders;
    const holder = async (id: string) => (await holders()).find((h) => h.id === id)!;
    const decisions = async () => {
      await call(BANK, '/api/bank/sync', {});
      return (await call<BankState>(BANK, '/api/bank/state')).decisions;
    };
    const last = async (): Promise<DecisionDTO> => (await decisions()).at(-1)!;
    const audit = (seq: number, mode: 'proof' | 'proof+data') => call<AuditReport>(AUDITOR, `/api/auditor/${study.id}/records/${seq}`, { mode });

    before(async () => {
      chain = await startLocalChain(ports.chain);
      deployment = await deployAll(chain.url, { verifier: dev ? 'mock' : 'honk', caseId: study.id });
      ({ app: bank } = await createBank(deployment, study));
      await bank.listen({ host: '127.0.0.1', port: ports.bank });
      const proofs = dev ? await DevProofSystem.create() : await UltraHonkProofSystem.create();
      ({ app: wallet } = await createWalletService(deployment, BANK, proofs, study));
      await wallet.listen({ host: '127.0.0.1', port: ports.wallet });
      ({ app: auditor } = await createAuditorService({ [study.id]: { bankUrl: BANK, deployment: () => deployment } }, AUDITOR_KEY));
      await auditor.listen({ host: '127.0.0.1', port: PORTS.auditor });
    });

    after(async () => {
      await auditor?.close();
      await wallet?.close();
      await bank?.close();
      chain?.process.kill();
    });

    test(`Screen 1: policy v${study.policy.version} is published on-chain`, async () => {
      const p = await call<{ version: number; documentHash: Hex }>(BANK, '/api/bank/policy/publish', {});
      const doc = await call<{ hash: Hex }>(BANK, '/api/bank/policy/document');
      assert.equal(p.version, study.policy.version);
      assert.equal(p.documentHash, doc.hash);
    });

    test('Screen 2: credentials, receive passes and issuance', async () => {
      const reg = await call<{ members: unknown[]; epoch: number }>(BANK, '/api/bank/credentials/issue', {});
      assert.equal(reg.members.length, study.holders.length);
      assert.equal(reg.epoch, 1);

      for (const id of [sender, receiver, sanctioned]) {
        const r = await call<ActionResult>(WALLET, `/api/wallet/holders/${id}/receive-pass`, {});
        assert.equal(r.ok, true, `${id}: ${r.message}`);
        assert.equal(r.proof?.publicInputs.length, 6);
      }
      const no = await call<ActionResult>(WALLET, `/api/wallet/holders/${ineligible}/receive-pass`, {});
      assert.equal(no.ok, false);
      assert.equal(no.stage, 'prove');
      assert.equal(no.reason, Reason.InvestorClass);

      for (const [id, amount] of study.issuance) await call(BANK, '/api/bank/subscriptions', { holderId: id, amount });
      assert.equal((await holder(sender)).balance, display(study.issuance[0][1]));
    });

    test('Screen 3: a compliant transfer settles with a proof and an audit envelope', async () => {
      const r = await transfer(sender, receiver, study.transferAmount, 'compliant-node');
      assert.equal(r.ok, true, r.message);
      assert.ok(r.proof!.proofBytes > 0);
      assert.ok(r.proof!.envelope && r.proof!.envelope.bytes > 100, 'an encrypted envelope travels with the transfer');
      const d = await last();
      assert.equal(d.outcome, Outcome.Settled);
      assert.equal(d.channel, Channel.CompliantNode);
      assert.equal(d.envelopeHash, r.proof!.envelope!.hash);
    });

    test(`Screen 4: revocation stops ${HOLDERS[sanctioned].name} on every route`, async () => {
      const before = (await call<BankState>(BANK, '/api/bank/state')).registry!.root;
      const reg = await call<{ root: Hex; epoch: number }>(BANK, `/api/bank/credentials/${sanctioned}/revoke`, { reason: 'Added to sanctions list 2026-10-31' });
      assert.notEqual(reg.root, before);
      assert.equal((await holder(sender)).hasReceivePass, false, 'passes lapse when the root changes');
      for (const id of [sender, receiver]) assert.equal((await call<ActionResult>(WALLET, `/api/wallet/holders/${id}/receive-pass`, {})).ok, true);

      const amount = study.tradingDay[3].amount;
      const viaNode = await transfer(sanctioned, sender, amount, 'compliant-node', 'stale');
      assert.equal(viaNode.stage, 'submit');
      assert.equal(viaNode.reason, Reason.Sanctioned);

      const direct = await transfer(sanctioned, sender, amount, 'direct', 'stale');
      assert.equal(direct.ok, false);
      assert.equal(direct.stage, 'settle');
      assert.equal(direct.reason, Reason.StaleRegistryRoot);
      assert.ok(direct.proof, 'the proof was valid for the old root, so it was built');

      const fresh = await transfer(sanctioned, sender, amount, 'direct', 'fresh');
      assert.equal(fresh.stage, 'prove');
      assert.equal(fresh.reason, Reason.NoCredential);

      const viaNodeIneligible = await transfer(ineligible, sender, amount, 'compliant-node', 'forged');
      assert.equal(viaNodeIneligible.reason, Reason.InvestorClass);

      const log = await decisions();
      assert.ok(
        log.find((d) => d.channel === Channel.Direct && d.reason === Reason.StaleRegistryRoot),
        'the attempt through another route is captured on-chain and logged',
      );
      assert.equal((await holder(sanctioned)).balance, display(study.issuance[2][1]));
    });

    test('Screen 5: trading day, anchoring, single-record audit and tamper detection', async () => {
      const results = await call<ActionResult[]>(WALLET, '/api/wallet/scenarios/trading-day', {});
      assert.deepEqual(
        results.map((r) => r.reason),
        TRADING_DAY_REASONS,
      );

      const all = await decisions();
      assert.ok(all.length >= 16, `expected a rich log, got ${all.length}`);

      const anchored = await call<{ batch: { batchId: number; root: Hex; count: number }; levels: Hex[][] }>(BANK, '/api/bank/audit/anchor', {});
      assert.equal(anchored.batch.count, all.length);

      const client = createPublicClient({ chain: hardhat, transport: http(chain.url) });
      const { decisionLogAnchor } = deployment.contracts;
      const blocked = all.find((d) => d.fromId === sanctioned && d.channel === Channel.Direct)!;
      const proof = await call<AuditRecordProof>(BANK, `/api/bank/audit/records/${blocked.seq}`);

      const recomputed = decisionLeaf({ ...proof.record, amount: BigInt(proof.record.amount), nonce: BigInt(proof.record.nonce) });
      assert.equal(recomputed, proof.leaf);
      assert.ok(DecisionTree.verify(recomputed, proof.siblings, proof.batch.root));
      const onChain = await client.readContract({
        address: decisionLogAnchor,
        abi: abi('DecisionLogAnchor'),
        functionName: 'verifyRecord',
        args: [BigInt(proof.batch.batchId), recomputed, proof.siblings],
      });
      assert.equal(onChain, true);

      const tampered = decisionLeaf({
        ...proof.record,
        amount: BigInt(proof.record.amount),
        nonce: BigInt(proof.record.nonce),
        outcome: Outcome.Settled,
        reason: Reason.None,
      });
      assert.equal(DecisionTree.verify(tampered, proof.siblings, proof.batch.root), false);
    });

    test('Auditor: every decision re-checks from evidence, with proof only and with proof + data', async () => {
      const all = await decisions();
      for (const d of all) {
        const p = await audit(d.seq, 'proof');
        assert.equal(p.conclusion.matchesRecord, true, `#${d.seq} proof-only: ${p.conclusion.summary} ${JSON.stringify(p.checks.filter((c) => !c.ok))}`);
        assert.equal(p.disclosed, null, 'proof-only audit discloses nothing');
        assert.ok(p.checks.every((c) => c.mode === 'proof'));

        const full = await audit(d.seq, 'proof+data');
        assert.equal(full.conclusion.matchesRecord, true, `#${d.seq} proof+data: ${full.conclusion.summary} ${JSON.stringify(full.checks.filter((c) => !c.ok))}`);
        assert.ok(full.disclosed, 'proof + data audit discloses the credential');
        assert.equal(full.disclosed!.holder, d.from);
        assert.equal(full.source, d.channel === Channel.CompliantNode && d.outcome === Outcome.Blocked ? 'bank-archive' : 'chain');
      }

      // With the data, the auditor can say *why* a proof failed, which the chain alone cannot.
      const invalid = all.find((d) => d.fromId === ineligible && d.channel === Channel.Direct)!;
      assert.equal(invalid.reason, Reason.InvalidProof);
      assert.equal((await audit(invalid.seq, 'proof')).conclusion.reason, Reason.InvalidProof);
      assert.equal((await audit(invalid.seq, 'proof+data')).conclusion.reason, Reason.InvestorClass);
    });

    test('reset returns the system to a clean slate', async () => {
      await call(WALLET, '/api/wallet/reset', {});
      const s = await call<BankState>(BANK, '/api/bank/reset', {});
      assert.equal(s.decisions.length, 0);
      assert.equal(s.policy, null);
      assert.equal((await holder(sender)).balance, '0.00');
    });
  });
}

caseStudy(CASES.client);
caseStudy(CASES.interbank);
