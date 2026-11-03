import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Hex } from 'viem';
import { CASE_IDS, type CaseId, type Deployment } from '@pc/shared';
import { createAuditorService, type AuditedCase } from './app';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const port = Number(process.env.AUDITOR_PORT ?? 8791);

/**
 * Demo-only key. In production the auditor generates its key pair itself and the
 * issuer publishes the public half in the policy, so only the auditor can decrypt.
 */
const AUDITOR_PRIVATE_KEY = (process.env.AUDITOR_PRIVATE_KEY ?? '0x8f46a2230a493a78a55b95a6efd2165d89a24aabad224e025fcd32e9db11d6b3') as Hex;

// BANK_URLS="client=http://127.0.0.1:8787,interbank=http://127.0.0.1:8789"
const bankUrls = Object.fromEntries(
  (process.env.BANK_URLS ?? 'client=http://127.0.0.1:8787,interbank=http://127.0.0.1:8789').split(',').map((kv) => kv.split('=') as [CaseId, string]),
);

const cases: Partial<Record<CaseId, AuditedCase>> = {};
for (const id of CASE_IDS) {
  if (!bankUrls[id]) continue;
  const file = join(root, '.runtime', `deployment-${id}.json`);
  cases[id] = { bankUrl: bankUrls[id], deployment: () => JSON.parse(readFileSync(file, 'utf8')) as Deployment };
}

const { app } = await createAuditorService(cases, AUDITOR_PRIVATE_KEY);
await app.listen({ host: '127.0.0.1', port });
console.log(`auditor service listening on http://127.0.0.1:${port}`);

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
