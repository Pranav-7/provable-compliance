import type { HolderId } from './cast';
import type { PolicyDocument } from './policy';
import { POLICY_INTERBANK_V1, POLICY_V12 } from './policyDocument';

export type CaseId = 'client' | 'interbank';
export type Route = 'compliant-node' | 'direct';
export type ProofMode = 'fresh' | 'stale' | 'forged';

/** The same four roles appear in every case study, so screens and scenarios stay generic. */
export interface CaseRoles {
  /** Eligible participant who initiates the headline transfer. */
  sender: HolderId;
  /** Eligible participant who receives it. */
  receiver: HolderId;
  /** Eligible at first, sanctioned midway. */
  sanctioned: HolderId;
  /** Never eligible under the policy. */
  ineligible: HolderId;
}

export interface ScenarioStep {
  from: HolderId;
  to: HolderId;
  amount: string;
  route: Route;
  mode: ProofMode;
  label: string;
}

export interface CaseConfig {
  id: CaseId;
  index: 1 | 2;
  title: string;
  subtitle: string;
  policy: PolicyDocument;
  /** Participants in credential-tree order. */
  holders: HolderId[];
  roles: CaseRoles;
  /** Initial issuance (subscription or deposit) per participant. */
  issuance: [HolderId, string][];
  /** Headline transfer on the "compliant transfer" screen. */
  transferAmount: string;
  /** How the UI names the two routes in this case. */
  routeLabels: Record<Route, string>;
  /** One compressed day of activity for the audit screen. */
  tradingDay: ScenarioStep[];
}

export const CASES: Record<CaseId, CaseConfig> = {
  client: {
    id: 'client',
    index: 1,
    title: 'Client transfers',
    subtitle: 'Tokenised money market fund units between clients',
    policy: POLICY_V12,
    holders: ['alice', 'bob', 'carol', 'dave'],
    roles: { sender: 'alice', receiver: 'bob', sanctioned: 'carol', ineligible: 'dave' },
    issuance: [
      ['alice', '10000.00'],
      ['bob', '12000.00'],
      ['carol', '5000.00'],
    ],
    transferAmount: '100.00',
    routeLabels: { 'compliant-node': "Issuing Bank's compliant node", direct: 'Directly to chain' },
    tradingDay: [
      { from: 'alice', to: 'bob', amount: '500.00', route: 'compliant-node', mode: 'fresh', label: 'Alice pays Bob through the bank node' },
      { from: 'bob', to: 'alice', amount: '1200.00', route: 'compliant-node', mode: 'fresh', label: 'Bob pays Alice through the bank node' },
      { from: 'dave', to: 'alice', amount: '100.00', route: 'compliant-node', mode: 'forged', label: 'Dave (retail) tries to send via the bank node' },
      { from: 'carol', to: 'bob', amount: '200.00', route: 'compliant-node', mode: 'stale', label: 'Carol (sanctioned) tries the bank node again' },
      { from: 'alice', to: 'bob', amount: '15000.00', route: 'compliant-node', mode: 'fresh', label: 'Alice sends Bob more than his balance cap allows' },
      { from: 'alice', to: 'bob', amount: '300.00', route: 'direct', mode: 'fresh', label: 'Alice pays Bob directly on-chain' },
      { from: 'carol', to: 'alice', amount: '200.00', route: 'direct', mode: 'stale', label: 'Carol submits her old proof directly' },
      { from: 'bob', to: 'dave', amount: '100.00', route: 'compliant-node', mode: 'fresh', label: 'Bob tries to pay Dave, who has no pass' },
      { from: 'bob', to: 'dave', amount: '100.00', route: 'direct', mode: 'fresh', label: 'Bob tries to pay Dave directly' },
      { from: 'alice', to: 'bob', amount: '250.00', route: 'compliant-node', mode: 'fresh', label: 'Alice pays Bob through the bank node' },
      { from: 'bob', to: 'alice', amount: '400.00', route: 'direct', mode: 'fresh', label: 'Bob pays Alice directly on-chain' },
      { from: 'dave', to: 'bob', amount: '50.00', route: 'direct', mode: 'forged', label: 'Dave submits an invalid proof directly' },
    ],
  },
  interbank: {
    id: 'interbank',
    index: 2,
    title: 'Interbank settlement',
    subtitle: 'Tokenised deposits settled between bank treasuries',
    policy: POLICY_INTERBANK_V1,
    holders: ['treasury', 'partner', 'regional', 'payments'],
    roles: { sender: 'treasury', receiver: 'partner', sanctioned: 'regional', ineligible: 'payments' },
    issuance: [
      ['treasury', '9000000.00'],
      ['partner', '4000000.00'],
      ['regional', '3000000.00'],
    ],
    transferAmount: '1000000.00',
    routeLabels: { 'compliant-node': "Issuing Bank's compliant node", direct: "Counterparty's own node" },
    tradingDay: [
      { from: 'treasury', to: 'partner', amount: '500000.00', route: 'compliant-node', mode: 'fresh', label: 'Treasury settles with Partner Bank via the issuer node' },
      { from: 'partner', to: 'treasury', amount: '1200000.00', route: 'direct', mode: 'fresh', label: 'Partner Bank settles back through its own node' },
      { from: 'payments', to: 'treasury', amount: '100000.00', route: 'compliant-node', mode: 'forged', label: 'Payments Firm (not a bank) tries to settle' },
      { from: 'regional', to: 'partner', amount: '200000.00', route: 'compliant-node', mode: 'stale', label: 'Regional Bank (sanctioned) tries the issuer node' },
      { from: 'treasury', to: 'partner', amount: '6000000.00', route: 'compliant-node', mode: 'fresh', label: "Treasury breaches Partner Bank's exposure limit" },
      { from: 'treasury', to: 'partner', amount: '300000.00', route: 'direct', mode: 'fresh', label: 'Treasury settles directly on-chain' },
      { from: 'regional', to: 'treasury', amount: '200000.00', route: 'direct', mode: 'stale', label: 'Regional Bank submits its old proof via its own node' },
      { from: 'partner', to: 'payments', amount: '100000.00', route: 'compliant-node', mode: 'fresh', label: 'Partner Bank tries to pay the Payments Firm' },
      { from: 'partner', to: 'payments', amount: '100000.00', route: 'direct', mode: 'fresh', label: 'Partner Bank tries again via its own node' },
      { from: 'treasury', to: 'partner', amount: '250000.00', route: 'compliant-node', mode: 'fresh', label: 'Treasury settles with Partner Bank via the issuer node' },
      { from: 'partner', to: 'treasury', amount: '400000.00', route: 'direct', mode: 'fresh', label: 'Partner Bank settles back through its own node' },
      { from: 'payments', to: 'partner', amount: '50000.00', route: 'direct', mode: 'forged', label: 'Payments Firm submits an invalid proof directly' },
    ],
  },
};

export const CASE_IDS = Object.keys(CASES) as CaseId[];

export function caseConfig(id: string | undefined): CaseConfig {
  const c = CASES[(id ?? 'client') as CaseId];
  if (!c) throw new Error(`Unknown case study "${id}". Expected one of: ${CASE_IDS.join(', ')}`);
  return c;
}
