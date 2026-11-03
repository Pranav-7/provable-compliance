import Fastify, { type FastifyInstance } from 'fastify';
import type { Hex } from 'viem';
import { canonicalPolicy, policyHash, toBaseUnits, type BankState, type CaseConfig, type HolderId } from '@pc/shared';
import { Chain } from './chain';
import { IssuerService } from './issuer';
import { DecisionLog } from './decisionLog';
import { CompliantNode } from './compliantNode';
import { ChainWatcher } from './watcher';
import { EventHub } from './events';
import type { Deployment } from '@pc/shared';

export interface BankContext {
  chain: Chain;
  issuer: IssuerService;
  log: DecisionLog;
  node: CompliantNode;
  watcher: ChainWatcher;
  events: EventHub;
  snapshot: Hex;
}

export async function createBank(deployment: Deployment, study: CaseConfig): Promise<{ app: FastifyInstance; ctx: BankContext }> {
  const isHolder = (id: string): id is HolderId => (study.holders as string[]).includes(id);
  const chain = new Chain(deployment);
  const events = new EventHub();
  const issuer = await IssuerService.create(chain, study);
  const log = new DecisionLog(chain);
  const publish = (decision: ReturnType<DecisionLog['append']>) => events.publish({ type: 'decision', decision });
  const node = new CompliantNode(chain, issuer, log, publish);
  const watcher = new ChainWatcher(chain, issuer, node, log, publish);
  await watcher.start();
  const snapshot = await chain.rpc<Hex>('evm_snapshot');
  const ctx: BankContext = { chain, issuer, log, node, watcher, events, snapshot };

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'warn' } });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 400;
    reply.status(status).send({ error: err.message.split('\n')[0] });
  });

  const state = (): BankState => ({
    deployment,
    policy: issuer.policy,
    registry: issuer.registry,
    decisions: log.list(),
    batches: log.listBatches(),
  });

  app.get('/health', async () => ({ ok: true, service: 'bank', caseId: study.id }));

  // --- Compliant RPC node (Layer 3 enforcement point) ---------------------------
  app.post('/rpc', async (req) => node.handle(req.body as never));

  // --- Issuer desk ----------------------------------------------------------------
  app.get('/api/bank/state', async () => state());

  app.get('/api/bank/policy/document', async () => ({
    document: issuer.policyDocument,
    canonical: canonicalPolicy(issuer.policyDocument),
    hash: policyHash(issuer.policyDocument),
  }));

  app.post('/api/bank/policy/publish', async () => {
    const policy = await issuer.publishPolicy();
    events.publish({ type: 'policy', policy });
    return policy;
  });

  app.post('/api/bank/credentials/issue', async () => {
    const registry = await issuer.issueCredentials();
    events.publish({ type: 'registry', registry });
    return registry;
  });

  app.post<{ Params: { holderId: string }; Body: { reason?: string } }>('/api/bank/credentials/:holderId/revoke', async (req) => {
    const { holderId } = req.params;
    if (!isHolder(holderId)) throw Object.assign(new Error(`Unknown holder ${holderId}`), { statusCode: 404 });
    const registry = await issuer.revoke(holderId, req.body?.reason ?? 'Added to sanctions list');
    events.publish({ type: 'registry', registry });
    return registry;
  });

  /** A holder collecting their own credential. In production this would be an authenticated wallet channel. */
  app.get<{ Params: { holderId: string } }>('/api/bank/credentials/:holderId', async (req, reply) => {
    const { holderId } = req.params;
    if (!isHolder(holderId)) return reply.status(404).send({ error: `Unknown holder ${holderId}` });
    try {
      const c = issuer.credentialFor(holderId);
      return {
        holderId,
        epoch: c.epoch,
        attributes: {
          salt: c.attributes.salt.toString(),
          holder: c.attributes.holder.toString(),
          country: c.attributes.country,
          investorClass: c.attributes.investorClass,
          expiry: c.attributes.expiry.toString(),
        },
        witness: { leafIndex: c.witness.leafIndex, path: c.witness.path.map(String), root: c.witness.root.toString() },
      };
    } catch (err) {
      return reply.status(410).send({ error: (err as Error).message });
    }
  });

  app.post<{ Body: { holderId: string; amount: string } }>('/api/bank/subscriptions', async (req) => {
    const { holderId, amount } = req.body;
    if (!isHolder(holderId)) throw new Error(`Unknown holder ${holderId}`);
    const txHash = await issuer.issueUnits(holderId, toBaseUnits(amount));
    return { txHash };
  });

  // --- Audit trail (Layer 4) ------------------------------------------------------
  app.post('/api/bank/audit/anchor', async () => {
    await watcher.flush();
    const result = await log.anchorPending();
    events.publish({ type: 'anchor', batch: result.batch });
    return result;
  });

  app.get<{ Params: { batchId: string } }>('/api/bank/audit/batches/:batchId', async (req) => log.batchShape(Number(req.params.batchId)));

  app.get<{ Params: { seq: string } }>('/api/bank/audit/records/:seq', async (req) => log.proofFor(Number(req.params.seq)));

  /** Raw bytes of a transaction the bank's node blocked before broadcast (never on-chain). */
  app.get<{ Params: { seq: string } }>('/api/bank/audit/records/:seq/raw-tx', async (req, reply) => {
    const archived = log.rawTx(Number(req.params.seq));
    if (!archived) return reply.status(404).send({ error: 'No archived transaction for this record (it was submitted on-chain)' });
    return { raw: archived.raw, stateBlock: archived.stateBlock.toString() };
  });

  // --- Live updates and housekeeping ---------------------------------------------
  app.get('/api/bank/events', (req, reply) => {
    reply.hijack();
    events.attach(reply.raw);
  });

  app.post('/api/bank/sync', async () => {
    await watcher.flush();
    return { decisions: log.list().length };
  });

  app.post('/api/bank/reset', async () => {
    await watcher.flush();
    await chain.rpc('evm_revert', [ctx.snapshot]);
    ctx.snapshot = await chain.rpc<Hex>('evm_snapshot');
    await issuer.reset();
    log.reset();
    node.reset();
    await watcher.resync();
    events.publish({ type: 'reset' });
    return state();
  });

  app.addHook('onClose', async () => {
    watcher.stop();
    await issuer.destroy();
  });

  return { app, ctx };
}
