import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { caseConfig, type Deployment } from '@pc/shared';
import { createWalletService } from './app';
import { DevProofSystem, UltraHonkProofSystem } from './proofSystem';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const study = caseConfig(process.env.CASE);
const deployment = JSON.parse(readFileSync(process.env.DEPLOYMENT_FILE ?? join(root, '.runtime', `deployment-${study.id}.json`), 'utf8')) as Deployment;
const port = Number(process.env.WALLET_PORT ?? 8788);
const bankUrl = process.env.BANK_URL ?? `http://127.0.0.1:${process.env.BANK_PORT ?? 8787}`;

const proofs = process.env.PROOF_SYSTEM === 'dev' ? await DevProofSystem.create() : await UltraHonkProofSystem.create();
const { app } = await createWalletService(deployment, bankUrl, proofs, study);
await app.listen({ host: '127.0.0.1', port });
console.log(`wallet service (${study.id}) listening on http://127.0.0.1:${port} (${proofs.kind} proofs)`);

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
