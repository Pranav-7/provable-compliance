import { create } from 'zustand';
import { CASES, type ActionResult, type AnchoredBatch, type AuditReport, type BankState, type CaseConfig, type CaseId, type DecisionDTO, type HolderView, type PolicyState, type RegistryState } from '@pc/shared';
import { bank, setApiCase, wallet } from './api';

export const SCREENS = [
  { title: 'Overview', layer: 'The idea in one picture' },
  { title: 'Publish the policy', layer: 'Layer 1' },
  { title: 'Issue credentials', layer: 'Layer 2' },
  { title: 'A compliant transfer', layer: 'Layer 3' },
  { title: 'Revocation on every route', layer: 'Layer 3' },
  { title: 'The audit trail', layer: 'Layer 4' },
  { title: 'Recap', layer: 'What was proven' },
] as const;

type Busy = Record<string, boolean>;

/** Per-screen results survive navigation, so a presenter can step back and forth freely. */
export interface ScreenResults {
  passes: Partial<Record<string, ActionResult>>;
  subscribed: boolean;
  transfer?: ActionResult;
  passRefresh: Partial<Record<string, ActionResult>>;
  attempts: Partial<Record<'node' | 'direct' | 'fresh' | 'ineligible', ActionResult>>;
  tradingDay?: ActionResult[];
  anchorLevels?: string[][];
  audits: Partial<Record<string, AuditReport>>;
}

/** Everything that belongs to one case study's running system. */
type CaseSlice = Pick<AppState, 'policy' | 'registry' | 'previousRegistry' | 'decisions' | 'batches' | 'holders' | 'results' | 'proofSystem'>;

interface AppState {
  caseId: CaseId;
  /** Saved state of the case study not on screen, so switching back is instant. */
  saved: Partial<Record<CaseId, CaseSlice>>;
  screen: number;
  technical: boolean;
  connected: boolean;
  proofSystem: 'ultrahonk' | 'dev' | null;
  policy: PolicyState | null;
  registry: RegistryState | null;
  /** Previous registry root, kept so revocation can animate the change. */
  previousRegistry: RegistryState | null;
  decisions: DecisionDTO[];
  batches: AnchoredBatch[];
  holders: HolderView[];
  busy: Busy;
  error: string | null;
  results: ScreenResults;

  go(screen: number): void;
  switchCase(id: CaseId): Promise<void>;
  toggleTechnical(): void;
  hydrate(state: BankState): void;
  refreshHolders(): Promise<void>;
  run<T>(key: string, fn: () => Promise<T>): Promise<T | undefined>;
  setResults(patch: Partial<ScreenResults> | ((r: ScreenResults) => Partial<ScreenResults>)): void;
  reset(): Promise<void>;
}

const EMPTY_RESULTS: ScreenResults = { passes: {}, subscribed: false, passRefresh: {}, attempts: {}, audits: {} };
const EMPTY_SLICE: CaseSlice = {
  policy: null,
  registry: null,
  previousRegistry: null,
  decisions: [],
  batches: [],
  holders: [],
  results: EMPTY_RESULTS,
  proofSystem: null,
};

export const useApp = create<AppState>((set, get) => ({
  caseId: 'interbank',
  saved: {},
  screen: 0,
  technical: false,
  connected: false,
  proofSystem: null,
  policy: null,
  registry: null,
  previousRegistry: null,
  decisions: [],
  batches: [],
  holders: [],
  busy: {},
  error: null,
  results: EMPTY_RESULTS,

  go: (screen) => set({ screen: Math.max(0, Math.min(SCREENS.length - 1, screen)), error: null }),
  toggleTechnical: () => set((s) => ({ technical: !s.technical })),

  switchCase: async (id) => {
    const s = get();
    if (id === s.caseId) return;
    const current: CaseSlice = {
      policy: s.policy,
      registry: s.registry,
      previousRegistry: s.previousRegistry,
      decisions: s.decisions,
      batches: s.batches,
      holders: s.holders,
      results: s.results,
      proofSystem: s.proofSystem,
    };
    setApiCase(id);
    set({ caseId: id, saved: { ...s.saved, [s.caseId]: current }, ...(s.saved[id] ?? EMPTY_SLICE), error: null, busy: {} });
    try {
      get().hydrate(await bank.state());
      await get().refreshHolders();
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  hydrate: (state) =>
    set({ policy: state.policy, registry: state.registry, decisions: state.decisions, batches: state.batches, connected: true }),

  refreshHolders: async () => {
    const { holders, proofSystem } = await wallet.holders();
    set({ holders, proofSystem });
  },

  run: async (key, fn) => {
    set((s) => ({ busy: { ...s.busy, [key]: true }, error: null }));
    try {
      return await fn();
    } catch (err) {
      set({ error: (err as Error).message });
      return undefined;
    } finally {
      set((s) => ({ busy: { ...s.busy, [key]: false } }));
      void get().refreshHolders().catch(() => undefined);
    }
  },

  setResults: (patch) => set((s) => ({ results: { ...s.results, ...(typeof patch === 'function' ? patch(s.results) : patch) } })),

  reset: async () => {
    await wallet.reset();
    const state = await bank.reset();
    set({ results: EMPTY_RESULTS, previousRegistry: null, screen: 1, error: null });
    get().hydrate(state);
    await get().refreshHolders();
  },
}));

/** Live updates from the bank. */
export function connectEvents(): () => void {
  return bank.subscribeEvents((e) => {
    const s = useApp.getState();
    switch (e.type) {
      case 'decision':
        useApp.setState({ decisions: [...s.decisions.filter((d) => d.seq !== e.decision.seq), e.decision].sort((a, b) => a.seq - b.seq) });
        break;
      case 'registry':
        useApp.setState({ previousRegistry: s.registry, registry: e.registry });
        break;
      case 'policy':
        useApp.setState({ policy: e.policy });
        break;
      case 'anchor':
        useApp.setState({
          batches: [...s.batches.filter((b) => b.batchId !== e.batch.batchId), e.batch],
          decisions: s.decisions.map((d) => (d.seq >= e.batch.firstSeq && d.seq < e.batch.firstSeq + e.batch.count ? { ...d, batchId: e.batch.batchId } : d)),
        });
        break;
      case 'reset':
        useApp.setState({ policy: null, registry: null, previousRegistry: null, decisions: [], batches: [] });
        break;
    }
  });
}

/** The case study on screen: its policy, participants, roles and labels. */
export const useStudy = (): CaseConfig => CASES[useApp((s) => s.caseId)];
