import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { caseConfig, type Deployment } from '@pc/shared';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const RUNTIME_DIR = join(REPO_ROOT, '.runtime');
/** Which case study this process serves (client | interbank). */
export const CASE = caseConfig(process.env.CASE);
export const DEPLOYMENT_FILE = join(RUNTIME_DIR, `deployment-${CASE.id}.json`);

export const BANK_PORT = Number(process.env.BANK_PORT ?? 8787);
export const WALLET_PORT = Number(process.env.WALLET_PORT ?? 8788);

export function loadDeployment(file = process.env.DEPLOYMENT_FILE ?? DEPLOYMENT_FILE): Deployment {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Deployment;
  } catch {
    throw new Error(`No deployment found at ${file}. Start the system with \`npm start\` from the repository root.`);
  }
}
