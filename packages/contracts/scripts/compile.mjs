#!/usr/bin/env node
/**
 * Compiles every contract under src/ with the pinned solc-js compiler and writes
 * ABI + bytecode to artifacts/<Contract>.json. Using solc-js keeps the build
 * fully offline and reproducible (no compiler download at runtime).
 */
import solc from 'solc';
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(pkgRoot, 'src');
const outDir = join(pkgRoot, 'artifacts');

function collect(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return collect(full);
    return name.endsWith('.sol') ? [full] : [];
  });
}

function findImport(path) {
  try {
    if (path.startsWith('@openzeppelin/')) {
      const resolved = require.resolve(path, { paths: [pkgRoot] });
      return { contents: readFileSync(resolved, 'utf8') };
    }
    const local = join(srcDir, path);
    if (existsSync(local)) return { contents: readFileSync(local, 'utf8') };
    return { error: `File not found: ${path}` };
  } catch (err) {
    return { error: String(err) };
  }
}

const files = collect(srcDir);
if (!files.some((f) => f.endsWith('HonkVerifier.sol'))) {
  console.warn('  HonkVerifier.sol not generated yet (run `npm run build -w @pc/circuits`); compiling without it.');
}

const sources = Object.fromEntries(files.map((f) => [relative(srcDir, f), { content: readFileSync(f, 'utf8') }]));
const input = {
  language: 'Solidity',
  sources,
  settings: {
    evmVersion: 'cancun',
    optimizer: { enabled: true, runs: 1 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.bytecode.linkReferences', 'evm.deployedBytecode.object'] } },
  },
};

const started = Date.now();
const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImport }));
const errors = (output.errors ?? []).filter((e) => e.severity === 'error');
for (const w of (output.errors ?? []).filter((e) => e.severity !== 'error')) {
  if (!w.sourceLocation?.file?.startsWith('generated/')) console.warn(w.formattedMessage);
}
if (errors.length) {
  for (const e of errors) console.error(e.formattedMessage);
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// Deployable contracts, plus any external libraries they must be linked against.
const deployable = new Set(['PolicyRegistry', 'CredentialRegistry', 'ComplianceGate', 'CompliantToken', 'DecisionLogAnchor', 'HonkVerifier', 'MockVerifier']);
const compiled = Object.entries(output.contracts).flatMap(([file, contracts]) =>
  Object.entries(contracts).map(([name, c]) => ({ file, name, c })),
);
const linkRefsOf = (c) =>
  Object.entries(c.evm.bytecode.linkReferences ?? {}).flatMap(([libFile, libs]) =>
    Object.entries(libs).map(([libName, refs]) => ({ library: libName, sourceName: libFile, offsets: refs.map((r) => r.start) })),
  );
for (const { c, name } of compiled) {
  if (deployable.has(name)) for (const ref of linkRefsOf(c)) deployable.add(ref.library);
}
let count = 0;
for (const { file, name, c } of compiled) {
  if (!deployable.has(name)) continue;
  writeFileSync(
    join(outDir, `${name}.json`),
    JSON.stringify({ contractName: name, sourceName: file, abi: c.abi, bytecode: `0x${c.evm.bytecode.object}`, linkReferences: linkRefsOf(c) }, null, 2),
  );
  count++;
}
console.log(`  contracts compiled        ${count} artifacts (solc ${solc.version().split('+')[0]}, ${((Date.now() - started) / 1000).toFixed(1)}s)`);
