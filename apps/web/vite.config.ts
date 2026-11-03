import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

const CASES = {
  client: { chain: 8545, bank: 8787, wallet: 8788 },
  interbank: { chain: 8546, bank: 8789, wallet: 8790 },
};
const AUDITOR = `http://127.0.0.1:${process.env.AUDITOR_PORT ?? 8791}`;

const proxy: Record<string, ProxyOptions | string> = { '/api/auditor': AUDITOR };
for (const [id, p] of Object.entries(CASES)) {
  proxy[`/api/${id}/bank`] = { target: `http://127.0.0.1:${p.bank}`, rewrite: (path) => path.replace(`/api/${id}/bank`, '/api/bank') };
  proxy[`/api/${id}/wallet`] = { target: `http://127.0.0.1:${p.wallet}`, rewrite: (path) => path.replace(`/api/${id}/wallet`, '/api/wallet') };
  proxy[`/chain/${id}`] = { target: `http://127.0.0.1:${p.chain}`, rewrite: () => '/' };
}

// In production `start.js` serves the built bundle and proxies these same paths.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1200 },
  server: { port: 5173, proxy },
});
