import { BANK_PORT, CASE, loadDeployment } from './config';
import { createBank } from './app';

const deployment = loadDeployment();
const { app } = await createBank(deployment, CASE);
await app.listen({ host: '127.0.0.1', port: BANK_PORT });
console.log(`bank service (${CASE.id}) listening on http://127.0.0.1:${BANK_PORT}`);

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
