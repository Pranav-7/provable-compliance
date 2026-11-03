import { createPublicClient, http, type Hex, type PublicClient } from 'viem';
import { hardhat } from 'viem/chains';
import type {
  ActionResult,
  AnchoredBatch,
  AuditRecordProof,
  AuditReport,
  BankEvent,
  CaseId,
  BankState,
  HolderView,
  PolicyDocument,
  PolicyState,
  RegistryState,
  Route,
} from '@pc/shared';

async function request<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  return json as T;
}

/**
 * Each case study runs its own chain, bank and wallets. The UI talks to the one
 * selected; `start.js` routes /api/<case>/bank, /api/<case>/wallet and /chain/<case>.
 */
let activeCase: CaseId = 'interbank';
export const setApiCase = (id: CaseId) => {
  activeCase = id;
};
const B = (path: string) => `/api/${activeCase}/bank${path}`;
const W = (path: string) => `/api/${activeCase}/wallet${path}`;

export const bank = {
  state: () => request<BankState>(B('/state')),
  policyDocument: () => request<{ document: PolicyDocument; canonical: string; hash: Hex }>(B('/policy/document')),
  publishPolicy: () => request<PolicyState>(B('/policy/publish'), {}),
  issueCredentials: () => request<RegistryState>(B('/credentials/issue'), {}),
  revoke: (holderId: string, reason: string) => request<RegistryState>(B(`/credentials/${holderId}/revoke`), { reason }),
  subscribe: (holderId: string, amount: string) => request<{ txHash: Hex }>(B('/subscriptions'), { holderId, amount }),
  anchor: () => request<{ batch: AnchoredBatch; levels: Hex[][] }>(B('/audit/anchor'), {}),
  recordProof: (seq: number) => request<AuditRecordProof>(B(`/audit/records/${seq}`)),
  sync: () => request<{ decisions: number }>(B('/sync'), {}),
  reset: () => request<BankState>(B('/reset'), {}),
  subscribeEvents(onEvent: (e: BankEvent) => void): () => void {
    const source = new EventSource(B('/events'));
    const types: BankEvent['type'][] = ['decision', 'registry', 'policy', 'anchor', 'reset'];
    for (const t of types) source.addEventListener(t, (msg) => onEvent(JSON.parse((msg as MessageEvent).data) as BankEvent));
    return () => source.close();
  },
};

export const wallet = {
  holders: () => request<{ proofSystem: 'ultrahonk' | 'dev'; holders: HolderView[] }>(W('/holders')),
  sync: (id: string) => request<{ status: string }>(W(`/holders/${id}/sync`), {}),
  receivePass: (id: string, route: Route = 'compliant-node') => request<ActionResult>(W(`/holders/${id}/receive-pass`), { route }),
  transfer: (p: { from: string; to: string; amount: string; route: Route; mode?: 'fresh' | 'stale' | 'forged' }) =>
    request<ActionResult>(W('/transfer'), p),
  tradingDay: () => request<ActionResult[]>(W('/scenarios/trading-day'), {}),
  reset: () => request<{ ok: boolean }>(W('/reset'), {}),
};

/** The independent auditor's service (one for both case studies). */
export const auditor = {
  check: (caseId: CaseId, seq: number, mode: AuditReport['mode']) => request<AuditReport>(`/api/auditor/${caseId}/records/${seq}`, { mode }),
};

const chains = new Map<CaseId, PublicClient>();
/** Direct, read-only access to the selected case's chain: the auditor does not need to trust the bank. */
export function chainClient(): PublicClient {
  let c = chains.get(activeCase);
  if (!c) {
    c = createPublicClient({ chain: hardhat, transport: http(`${location.origin}/chain/${activeCase}`) }) as PublicClient;
    chains.set(activeCase, c);
  }
  return c;
}

export const DECISION_LOG_ANCHOR_ABI = [
  {
    type: 'function',
    name: 'verifyRecord',
    stateMutability: 'view',
    inputs: [
      { name: 'batchId', type: 'uint256' },
      { name: 'leaf', type: 'bytes32' },
      { name: 'proof', type: 'bytes32[]' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'batch',
    stateMutability: 'view',
    inputs: [{ name: 'batchId', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'root', type: 'bytes32' },
          { name: 'firstSeq', type: 'uint32' },
          { name: 'count', type: 'uint32' },
          { name: 'anchoredAt', type: 'uint64' },
        ],
      },
    ],
  },
] as const;
