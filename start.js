#!/usr/bin/env node
/**
 * One command to run the whole proof of concept:
 *
 *   node start.js            (or: npm start)
 *
 * It installs dependencies on first run, builds the ZK circuit, its Solidity
 * verifier, the contracts and the UI (only when sources changed), then starts:
 *
 *   local chain     Hardhat JSON-RPC node                :8546
 *   bank service    issuer desk, compliant node, log     :8789
 *   wallet service  participants' wallets and prover     :8790
 *   auditor         independent re-checking of records   :8791
 *   web UI          the walkthrough                      :3000
 *
 * Options:
 *   --no-open      do not open the browser
 *   --dev-proofs   skip real proving (for machines that cannot download the
 *                  public trusted setup); the circuit is still executed
 *
 * Press Ctrl+C to stop everything. Service logs are written to .runtime/logs/.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync, createWriteStream } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const RUNTIME = join(ROOT, '.runtime');
const LOGS = join(RUNTIME, 'logs');
const CASES = {
  interbank: { label: 'interbank settlement', chain: 8546, bank: 8789, wallet: 8790 },
};
const PORTS = {
  ...Object.fromEntries(Object.entries(CASES).flatMap(([id, c]) => [[`${id} chain`, c.chain], [`${id} bank`, c.bank], [`${id} wallet`, c.wallet]])),
  auditor: 8791,
  web: 3000,
};
const args = new Set(process.argv.slice(2));
const DEV_PROOFS = args.has('--dev-proofs');
const OPEN = !args.has('--no-open');

const isTTY = process.stdout.isTTY;
const c = (code) => (s) => (isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = c('1');
const dim = c('2');
const green = c('32');
const red = c('31');
const blue = c('34');

const children = [];
let shuttingDown = false;

function step(label) {
  process.stdout.write(`  ${label.padEnd(42)}`);
  const started = Date.now();
  return {
    ok: (note = '') => console.log(`${green('done')} ${dim(`${((Date.now() - started) / 1000).toFixed(1)}s${note ? `  ${note}` : ''}`)}`),
    skip: (note) => console.log(dim(note)),
    fail: (note) => console.log(red(note)),
  };
}

function fatal(message, hint) {
  console.error(`\n  ${red('✗')} ${bold(message)}`);
  if (hint) console.error(`    ${hint}`);
  console.error(`    ${dim(`Logs: ${LOGS}`)}\n`);
  shutdown(1);
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

function checkNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 20 || (major === 20 && minor < 10)) {
    fatal(`Node.js ${process.versions.node} is too old.`, 'Install Node.js 20.10 or newer (22 LTS recommended) from https://nodejs.org and try again.');
  }
}

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

async function checkPorts() {
  for (const [name, port] of Object.entries(PORTS)) {
    if (!(await portFree(port))) {
      fatal(`Port ${port} (${name}) is already in use.`, `Stop whatever is using it (on macOS: lsof -i :${port}) or close a previous run of this demo, then try again.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Build (incremental)
// ---------------------------------------------------------------------------

function newest(paths) {
  let t = 0;
  const walk = (p) => {
    if (!existsSync(p)) return;
    const s = statSync(p);
    if (s.isDirectory()) {
      for (const f of readdirSync(p)) if (f !== 'node_modules' && f !== 'dist' && f !== 'artifacts' && f !== 'target') walk(join(p, f));
    } else t = Math.max(t, s.mtimeMs);
  };
  paths.forEach(walk);
  return t;
}

const stale = (outputs, inputs) => outputs.some((o) => !existsSync(o)) || Math.min(...outputs.map((o) => statSync(o).mtimeMs)) < newest(inputs);

function run(cmd, cmdArgs, logName, env = {}) {
  const log = join(LOGS, `${logName}.log`);
  const res = spawnSync(cmd, cmdArgs, { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8' });
  writeFileSync(log, `${res.stdout ?? ''}\n${res.stderr ?? ''}`);
  return res;
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function ensureInstalled() {
  const s = step('Installing dependencies');
  const marker = join(ROOT, 'node_modules', '.package-lock.json');
  if (existsSync(marker) && statSync(marker).mtimeMs >= statSync(join(ROOT, 'package-lock.json')).mtimeMs) return s.skip('up to date');
  const res = run(npm, ['install', '--no-audit', '--no-fund'], 'install');
  if (res.status !== 0) {
    s.fail('failed');
    fatal('npm install failed.', 'Check your internet connection and run `npm install` to see the full error.');
  }
  s.ok();
}

function buildCircuit() {
  const s = step('Building ZK circuit and verifier');
  const circuitSrc = join(ROOT, 'packages/circuits/eligibility');
  const outputs = [join(ROOT, 'packages/circuits/target/eligibility.json')];
  const verifier = join(ROOT, 'packages/contracts/src/generated/HonkVerifier.sol');
  if (!DEV_PROOFS) outputs.push(verifier);
  if (!stale(outputs, [circuitSrc])) return s.skip('up to date');
  const res = run('node', ['packages/circuits/scripts/build.mjs', ...(DEV_PROOFS ? ['--skip-verifier'] : [])], 'build-circuit');
  if (res.status !== 0) {
    s.fail('failed');
    fatal(
      'Could not build the circuit verifier.',
      'The first build downloads Aztec’s public trusted setup (a few MB). Check your internet connection, or run with --dev-proofs to skip real proving.',
    );
  }
  s.ok(DEV_PROOFS ? 'circuit only' : 'UltraHonk verifier generated');
}

function buildContracts() {
  const s = step('Compiling smart contracts');
  const outputs = [join(ROOT, 'packages/contracts/artifacts/ComplianceGate.json')];
  if (!DEV_PROOFS) outputs.push(join(ROOT, 'packages/contracts/artifacts/HonkVerifier.json'));
  if (!stale(outputs, [join(ROOT, 'packages/contracts/src')])) return s.skip('up to date');
  const res = run('node', ['packages/contracts/scripts/compile.mjs'], 'compile-contracts');
  if (res.status !== 0) {
    s.fail('failed');
    fatal('Contract compilation failed.');
  }
  s.ok();
}

function buildWeb() {
  const s = step('Building the web UI');
  const outputs = [join(ROOT, 'apps/web/dist/index.html')];
  if (!stale(outputs, [join(ROOT, 'apps/web/src'), join(ROOT, 'apps/web/index.html'), join(ROOT, 'packages/shared/src')])) return s.skip('up to date');
  const res = run(npm, ['run', 'build', '-w', '@pc/web'], 'build-web');
  if (res.status !== 0) {
    s.fail('failed');
    fatal('Building the UI failed.');
  }
  s.ok();
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

function startService(name, cmd, cmdArgs, env = {}) {
  const out = createWriteStream(join(LOGS, `${name}.log`), { flags: 'w' });
  const child = spawn(cmd, cmdArgs, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(out);
  child.stderr.pipe(out);
  child.on('exit', (code) => {
    if (!shuttingDown) fatal(`The ${name} stopped unexpectedly (exit code ${code}).`, `See ${join(LOGS, `${name}.log`)}`);
  });
  children.push(child);
  return child;
}

async function waitFor(url, init, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return;
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  fatal(`${label} did not start in time.`);
}

async function startChains() {
  const s = step('Starting local blockchains');
  const hardhat = join(ROOT, 'node_modules/hardhat/internal/cli/bootstrap.js');
  for (const [id, cs] of Object.entries(CASES)) {
    startService(`chain-${id}`, 'node', [hardhat, '--config', 'packages/contracts/hardhat.config.cjs', 'node', '--hostname', '127.0.0.1', '--port', String(cs.chain)], {
      HARDHAT_DISABLE_TELEMETRY_PROMPT: 'true',
    });
  }
  for (const cs of Object.values(CASES)) {
    await waitFor(
      `http://127.0.0.1:${cs.chain}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) },
      60_000,
      'The local blockchain',
    );
  }
  s.ok(Object.values(CASES).map((cs) => `:${cs.chain}`).join(' '));
}

function deploy() {
  const s = step('Deploying contracts');
  for (const [id, cs] of Object.entries(CASES)) {
    const res = run(
      'node',
      ['--import', 'tsx', 'packages/contracts/scripts/deploy.ts', `http://127.0.0.1:${cs.chain}`, join(RUNTIME, `deployment-${id}.json`), DEV_PROOFS ? 'mock' : 'honk', id],
      `deploy-${id}`,
    );
    if (res.status !== 0) {
      s.fail('failed');
      fatal(`Deployment failed (${cs.label}).`);
    }
  }
  s.ok(DEV_PROOFS ? 'MockVerifier' : 'HonkVerifier + 5 contracts');
}

async function startBackends() {
  const proofSystem = DEV_PROOFS ? 'dev' : 'ultrahonk';
  for (const [id, cs] of Object.entries(CASES)) {
    const env = { CASE: id, BANK_PORT: String(cs.bank), WALLET_PORT: String(cs.wallet), PROOF_SYSTEM: proofSystem };
    let s = step('Starting bank service');
    startService(`bank-${id}`, 'node', ['--import', 'tsx', 'apps/server/src/main.ts'], env);
    await waitFor(`http://127.0.0.1:${cs.bank}/health`, {}, 60_000, `The bank service (${id})`);
    s.ok(`127.0.0.1:${cs.bank}`);

    s = step('Starting wallets and prover');
    startService(`wallet-${id}`, 'node', ['--import', 'tsx', 'apps/wallet/src/main.ts'], env);
    await waitFor(`http://127.0.0.1:${cs.wallet}/health`, {}, 180_000, `The wallet service (${id})`);
    s.ok(`127.0.0.1:${cs.wallet}`);
  }

  const s = step('Starting independent auditor');
  const bankUrls = Object.entries(CASES).map(([id, cs]) => `${id}=http://127.0.0.1:${cs.bank}`).join(',');
  startService('auditor', 'node', ['--import', 'tsx', 'apps/auditor/src/main.ts'], { AUDITOR_PORT: String(PORTS.auditor), BANK_URLS: bankUrls });
  await waitFor(`http://127.0.0.1:${PORTS.auditor}/health`, {}, 60_000, 'The auditor');
  s.ok(`127.0.0.1:${PORTS.auditor}`);
}

// ---------------------------------------------------------------------------
// UI host: static bundle + same-origin proxy to the services
// ---------------------------------------------------------------------------

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.png': 'image/png' };

function proxy(req, res, port, path) {
  const upstream = http.request({ host: '127.0.0.1', port, path, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` } }, (up) => {
    res.writeHead(up.statusCode ?? 502, up.headers);
    up.pipe(res);
  });
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Service unavailable' }));
  });
  req.pipe(upstream);
}

function startWeb() {
  const s = step('Serving the web UI');
  const dist = join(ROOT, 'apps/web/dist');
  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    // /api/<case>/bank/...  /api/<case>/wallet/...  /chain/<case>  /api/auditor/...
    const scoped = url.match(/^\/api\/(interbank)\/(bank|wallet)(\/.*)?$/);
    if (scoped) {
      const [, id, svc, rest = ''] = scoped;
      return proxy(req, res, CASES[id][svc], `/api/${svc}${rest}`);
    }
    const chainMatch = url.match(/^\/chain\/(interbank)/);
    if (chainMatch) return proxy(req, res, CASES[chainMatch[1]].chain, '/');
    if (url.startsWith('/api/auditor')) return proxy(req, res, PORTS.auditor, url);
    const clean = normalize(decodeURIComponent(url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    let file = join(dist, clean);
    if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    createReadStream(file).pipe(res);
  });
  server.listen(PORTS.web, '127.0.0.1');
  children.push({ kill: () => server.close() });
  s.ok(`127.0.0.1:${PORTS.web}`);
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const cmdArgs = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* user can open it manually */
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children.reverse()) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(code), 300);
}

process.on('SIGINT', () => {
  console.log(`\n  ${dim('Stopping all services…')}`);
  shutdown(0);
});
process.on('SIGTERM', () => shutdown(0));

// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n  ${bold('Provable Compliance')} ${dim('· from enforcement to evidence')}\n`);
  mkdirSync(LOGS, { recursive: true });
  checkNode();
  await checkPorts();
  ensureInstalled();
  buildCircuit();
  buildContracts();
  buildWeb();
  await startChains();
  deploy();
  await startBackends();
  startWeb();

  const url = `http://localhost:${PORTS.web}`;
  console.log(`\n  ${green('●')} ${bold('Ready.')} Open ${blue(url)}${DEV_PROOFS ? dim('  (development proofs)') : ''}`);
  console.log(`  ${dim('Press Ctrl+C to stop.')}\n`);
  if (OPEN) openBrowser(url);
}

main().catch((err) => fatal(err?.message ?? String(err)));
