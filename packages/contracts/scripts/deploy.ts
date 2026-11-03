/**
 * Deploys the full system to a running node and writes the deployment manifest.
 *   node --import tsx packages/contracts/scripts/deploy.ts <rpcUrl> <outFile> [honk|mock] [client|interbank]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { deployAll } from '../lib/index';

const [rpcUrl, outFile, verifier = 'honk', caseId = 'client'] = process.argv.slice(2);
if (!rpcUrl || !outFile || (verifier !== 'honk' && verifier !== 'mock') || (caseId !== 'client' && caseId !== 'interbank')) {
  console.error('usage: deploy.ts <rpcUrl> <outFile> [honk|mock] [client|interbank]');
  process.exit(2);
}

const deployment = await deployAll(rpcUrl, { verifier, caseId });
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(deployment, null, 2));
console.log(JSON.stringify(deployment.contracts));
