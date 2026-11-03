import { readFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BaseError,
  decodeErrorResult,
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hardhat } from 'viem/chains';
import { DEV_PRIVATE_KEYS, caseConfig, type CaseId, type Deployment } from '@pc/shared';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export type ContractName =
  | 'PolicyRegistry'
  | 'CredentialRegistry'
  | 'ComplianceGate'
  | 'CompliantToken'
  | 'DecisionLogAnchor'
  | 'HonkVerifier'
  | 'MockVerifier'
  | 'RelationsLib'
  | 'ZKTranscriptLib';

interface Artifact {
  contractName: string;
  abi: Abi;
  bytecode: Hex;
  linkReferences: { library: string; sourceName: string; offsets: number[] }[];
}

const cache = new Map<ContractName, Artifact>();

export function artifact(name: ContractName): Artifact {
  let a = cache.get(name);
  if (!a) {
    a = JSON.parse(readFileSync(join(pkgRoot, 'artifacts', `${name}.json`), 'utf8')) as Artifact;
    cache.set(name, a);
  }
  return a;
}

const SYSTEM: ContractName[] = ['PolicyRegistry', 'CredentialRegistry', 'ComplianceGate', 'CompliantToken', 'DecisionLogAnchor'];
let systemErrors: Abi | null = null;

/**
 * ABI of a contract, extended with every custom error defined across the system.
 * Errors raised by the ComplianceGate bubble up through the token, so callers of
 * the token need the gate's error definitions to decode a revert.
 */
export function abi(name: ContractName): Abi {
  systemErrors ??= (() => {
    const seen = new Set<string>();
    return SYSTEM.flatMap((n) => artifact(n).abi).filter((item) => {
      if (item.type !== 'error') return false;
      const key = `${item.name}(${item.inputs.map((i) => i.type).join(',')})`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })();
  const own = artifact(name).abi;
  const ownErrors = new Set(own.filter((i) => i.type === 'error').map((i) => (i as { name: string }).name));
  return [...own, ...systemErrors.filter((e) => !ownErrors.has((e as { name: string }).name))];
}

/** Replaces solc library placeholders with deployed library addresses. */
export function linkBytecode(a: Artifact, libraries: Record<string, Address>): Hex {
  let code = a.bytecode.slice(2);
  for (const ref of a.linkReferences) {
    const address = libraries[ref.library];
    if (!address) throw new Error(`${a.contractName} needs library ${ref.library}`);
    for (const offset of ref.offsets) {
      const at = offset * 2;
      code = code.slice(0, at) + address.slice(2).toLowerCase() + code.slice(at + 40);
    }
  }
  return `0x${code}`;
}

export interface ChainClients {
  publicClient: PublicClient;
  issuer: WalletClient;
}

export function clients(rpcUrl: string): ChainClients {
  const transport = http(rpcUrl);
  return {
    publicClient: createPublicClient({ chain: hardhat, transport }),
    issuer: createWalletClient({ chain: hardhat, transport, account: privateKeyToAccount(DEV_PRIVATE_KEYS[0]) }),
  };
}

async function deploy(c: ChainClients, name: ContractName, args: unknown[] = [], libraries: Record<string, Address> = {}): Promise<Address> {
  const a = artifact(name);
  const hash = await c.issuer.deployContract({
    abi: a.abi,
    bytecode: linkBytecode(a, libraries),
    args,
    account: c.issuer.account!,
    chain: hardhat,
  });
  const receipt = await c.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`Deployment of ${name} failed`);
  return receipt.contractAddress;
}

/**
 * Deploys the full system for one case study. `verifier: 'honk'` uses the
 * verifier generated from the circuit (the real thing); `'mock'` is for
 * contract unit tests only.
 */
export async function deployAll(
  rpcUrl: string,
  opts: { verifier: 'honk' | 'mock'; caseId?: CaseId } = { verifier: 'honk' },
): Promise<Deployment> {
  const study = caseConfig(opts.caseId);
  const c = clients(rpcUrl);
  const issuer = c.issuer.account!.address;

  let verifier: Address;
  if (opts.verifier === 'honk') {
    const libs: Record<string, Address> = {};
    for (const ref of artifact('HonkVerifier').linkReferences) {
      libs[ref.library] ??= await deploy(c, ref.library as ContractName);
    }
    verifier = await deploy(c, 'HonkVerifier', [], libs);
  } else {
    verifier = await deploy(c, 'MockVerifier');
  }

  const policyRegistry = await deploy(c, 'PolicyRegistry', [issuer]);
  const credentialRegistry = await deploy(c, 'CredentialRegistry', [issuer]);
  const complianceGate = await deploy(c, 'ComplianceGate', [issuer, policyRegistry, credentialRegistry, verifier]);
  const token = await deploy(c, 'CompliantToken', [issuer, complianceGate, study.policy.asset.name, study.policy.asset.symbol]);
  const decisionLogAnchor = await deploy(c, 'DecisionLogAnchor', [issuer]);

  const bind = await c.issuer.writeContract({
    address: complianceGate,
    abi: abi('ComplianceGate'),
    functionName: 'bindToken',
    args: [token],
    account: c.issuer.account!,
    chain: hardhat,
  });
  await c.publicClient.waitForTransactionReceipt({ hash: bind });

  return {
    caseId: study.id,
    chainId: hardhat.id,
    rpcUrl,
    deployer: issuer,
    contracts: { policyRegistry, credentialRegistry, complianceGate, token, decisionLogAnchor, verifier },
    deployedAt: Date.now(),
  };
}

/** Starts a local Hardhat JSON-RPC node and resolves once it answers requests. */
export async function startLocalChain(port: number, opts: { silent?: boolean } = {}): Promise<{ url: string; process: ChildProcess }> {
  const require = createRequire(import.meta.url);
  const hardhatBin = join(dirname(require.resolve('hardhat/package.json')), 'internal', 'cli', 'bootstrap.js');
  const child = spawn(process.execPath, [hardhatBin, '--config', join(pkgRoot, 'hardhat.config.cjs'), 'node', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: pkgRoot,
    env: { ...process.env, HARDHAT_DISABLE_TELEMETRY_PROMPT: 'true' },
    stdio: opts.silent === false ? 'inherit' : 'ignore',
  });
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Local chain exited early (code ${child.exitCode}). Is port ${port} already in use?`);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      if (res.ok) return { url, process: child };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill();
  throw new Error('Local chain did not start within 60s');
}

/**
 * Extracts the custom-error name from a failed call, however the node packaged it.
 * (viem surfaces Hardhat's revert data nested inside the RPC error payload.)
 */
export function revertErrorName(err: unknown): string | undefined {
  const isHex = (v: unknown): v is Hex => typeof v === 'string' && /^0x[0-9a-fA-F]{8,}$/.test(v);
  let data: Hex | undefined;
  const visit = (e: unknown) => {
    if (!e || typeof e !== 'object' || data) return;
    const d = (e as { data?: unknown }).data;
    if (isHex(d)) data = d;
    else if (d && typeof d === 'object' && isHex((d as { data?: unknown }).data)) data = (d as { data: Hex }).data;
  };
  if (err instanceof BaseError) err.walk((e) => (visit(e), false));
  else visit(err);
  if (!data) return undefined;
  try {
    return decodeErrorResult({ abi: abi('CompliantToken'), data }).errorName;
  } catch {
    return undefined;
  }
}
