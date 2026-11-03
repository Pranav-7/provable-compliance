import Fastify, { type FastifyInstance } from 'fastify';
import type { CaseConfig, Deployment, HolderId, ProofMode, Route } from '@pc/shared';
import { HolderWallets } from './wallets';
import { runScenario } from './scenarios';
import type { ProofSystem } from './proofSystem';

const ROUTES: Route[] = ['compliant-node', 'direct'];
const MODES: ProofMode[] = ['fresh', 'stale', 'forged'];

export async function createWalletService(
  deployment: Deployment,
  bankUrl: string,
  proofs: ProofSystem,
  study: CaseConfig,
): Promise<{ app: FastifyInstance; wallets: HolderWallets }> {
  const isHolder = (id: string): id is HolderId => (study.holders as string[]).includes(id);
  const wallets = new HolderWallets(deployment, bankUrl, proofs, study);
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'warn' } });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 400;
    reply.status(status).send({ error: err.message.split('\n')[0] });
  });

  const holder = (id: string): HolderId => {
    if (!isHolder(id)) throw Object.assign(new Error(`Unknown holder ${id}`), { statusCode: 404 });
    return id;
  };

  app.get('/health', async () => ({ ok: true, service: 'wallet', caseId: study.id, proofSystem: proofs.kind }));

  app.get('/api/wallet/holders', async () => ({ proofSystem: proofs.kind, holders: await wallets.views() }));

  app.post<{ Params: { id: string } }>('/api/wallet/holders/:id/sync', async (req) => ({ status: await wallets.sync(holder(req.params.id)) }));

  app.post<{ Params: { id: string }; Body: { route?: Route } }>('/api/wallet/holders/:id/receive-pass', async (req) =>
    wallets.registerReceivePass(holder(req.params.id), req.body?.route ?? 'compliant-node'),
  );

  app.post<{ Body: { from: string; to: string; amount: string; route?: Route; mode?: ProofMode } }>('/api/wallet/transfer', async (req) => {
    const { from, to, amount, route = 'compliant-node', mode = 'fresh' } = req.body;
    if (!ROUTES.includes(route)) throw new Error(`Unknown route ${route}`);
    if (!MODES.includes(mode)) throw new Error(`Unknown proof mode ${mode}`);
    return wallets.transfer({ from: holder(from), to: holder(to), amount, route, mode });
  });

  app.get('/api/wallet/scenarios/trading-day', async () => study.tradingDay);

  app.post('/api/wallet/scenarios/trading-day', async () => {
    for (const id of [study.roles.sender, study.roles.receiver]) {
      const view = (await wallets.views()).find((h) => h.id === id);
      if (view && !view.hasReceivePass) await wallets.registerReceivePass(id);
    }
    return runScenario(wallets, study.tradingDay);
  });

  app.post('/api/wallet/reset', async () => {
    wallets.reset();
    return { ok: true };
  });

  app.addHook('onClose', async () => proofs.destroy());
  return { app, wallets };
}
