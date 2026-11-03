import Fastify, { type FastifyInstance } from 'fastify';
import type { Hex } from 'viem';
import { CASE_IDS, type AuditRecordProof, type CaseId, type Deployment } from '@pc/shared';
import { Auditor, type AuditMode } from './auditor';

export interface AuditedCase {
  /** Public deployment record: chain endpoint and contract addresses. */
  deployment: () => Deployment;
  /** Base URL of the issuing bank's audit API (untrusted: every answer is re-checked on-chain). */
  bankUrl: string;
}

const MODES: AuditMode[] = ['proof', 'proof+data'];

/**
 * The auditor's service. It asks the bank only for what the bank alone holds (a
 * record's inclusion proof, and the bytes of transactions its node held back) and
 * verifies everything else itself.
 */
export async function createAuditorService(cases: Partial<Record<CaseId, AuditedCase>>, privateKey: Hex): Promise<{ app: FastifyInstance; auditor: Auditor }> {
  const auditor = await Auditor.create(privateKey);
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'warn' } });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 400;
    reply.status(status).send({ error: err.message.split('\n')[0] });
  });

  app.get('/health', async () => ({ ok: true, service: 'auditor', cases: Object.keys(cases) }));

  app.post<{ Params: { caseId: string; seq: string }; Body: { mode?: AuditMode } }>('/api/auditor/:caseId/records/:seq', async (req) => {
    const caseId = req.params.caseId as CaseId;
    const audited = CASE_IDS.includes(caseId) ? cases[caseId] : undefined;
    if (!audited) throw Object.assign(new Error(`Unknown case ${req.params.caseId}`), { statusCode: 404 });
    const mode = req.body?.mode ?? 'proof';
    if (!MODES.includes(mode)) throw new Error(`Unknown audit mode ${mode}`);
    const seq = Number(req.params.seq);

    const res = await fetch(`${audited.bankUrl}/api/bank/audit/records/${seq}`);
    if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `Bank returned ${res.status}`);
    const evidence = (await res.json()) as AuditRecordProof;

    return auditor.audit({
      caseId,
      deployment: audited.deployment(),
      evidence,
      mode,
      archived: async (s) => {
        const r = await fetch(`${audited.bankUrl}/api/bank/audit/records/${s}/raw-tx`);
        return r.ok ? ((await r.json()) as { raw: Hex; stateBlock: string }) : null;
      },
    });
  });

  app.addHook('onClose', async () => auditor.destroy());
  return { app, auditor };
}
