import canonicalize from 'canonicalize';
import { keccak256, toBytes, type Hex } from 'viem';
import { INVESTOR_CLASS, ISO_NUMERIC, MAX_COUNTRIES, TOKEN_DECIMALS, type InvestorClassName } from './constants';

/**
 * Machine-readable transfer policy.
 *
 * Rule types deliberately mirror the vocabulary of existing token-compliance
 * frameworks (ERC-3643 modular compliance: CountryAllow, MaxBalance; CMTA
 * RuleEngine: whitelist and sanctions-list rules) so the document reads the way
 * a compliance or legal team would expect. Each rule also states *where* it is
 * enforced: inside the zero-knowledge proof, by credential revocation, or by the
 * token contract itself.
 */
export type Enforcement = 'zk-proof' | 'credential-revocation' | 'on-chain';

export type PolicyRule =
  | { id: string; type: 'CountryAllow'; description: string; enforcement: Enforcement; params: { countries: string[] } }
  | { id: string; type: 'InvestorClassAllow'; description: string; enforcement: Enforcement; params: { classes: InvestorClassName[] } }
  | { id: string; type: 'SanctionsScreen'; description: string; enforcement: Enforcement; params: { list: string; listVersion: string } }
  | { id: string; type: 'CredentialValidity'; description: string; enforcement: Enforcement; params: { requireUnexpired: boolean } }
  | { id: string; type: 'MaxBalance'; description: string; enforcement: Enforcement; params: { maxHolderBalance: string } }
  | { id: string; type: 'RecipientEligibility'; description: string; enforcement: Enforcement; params: { requireReceivePass: boolean } }
  | { id: string; type: 'AuditDisclosure'; description: string; enforcement: Enforcement; params: { recipient: string; scheme: string } };

export interface PolicyDocument {
  schema: string;
  policyId: string;
  version: number;
  status: 'illustrative';
  issuer: { name: string; lei: string };
  asset: { name: string; symbol: string; type: string; identifier: string; decimals: number };
  effectiveFrom: string;
  references: string[];
  rules: PolicyRule[];
  approval: { role: string; date: string };
}

/** Parameters the on-chain PolicyRegistry stores and the verifier feeds into every proof. */
export interface OnChainPolicyParams {
  allowedCountries: [number, number, number, number];
  allowedClassMask: number;
  maxHolderBalance: bigint;
  effectiveFrom: bigint;
}

/** RFC 8785 (JSON Canonicalization Scheme) serialisation: same policy, same bytes, same hash. */
export function canonicalPolicy(doc: PolicyDocument): string {
  const out = canonicalize(doc);
  if (out === undefined) throw new Error('Policy document could not be canonicalised');
  return out;
}

/** keccak256 fingerprint of the canonical policy document. */
export function policyHash(doc: PolicyDocument): Hex {
  return keccak256(toBytes(canonicalPolicy(doc)));
}

function ruleOf<T extends PolicyRule['type']>(doc: PolicyDocument, type: T): Extract<PolicyRule, { type: T }> {
  const rule = doc.rules.find((r) => r.type === type);
  if (!rule) throw new Error(`Policy ${doc.policyId} v${doc.version} has no ${type} rule`);
  return rule as Extract<PolicyRule, { type: T }>;
}

/** Converts a decimal string ("250000.00") into token base units. */
export function toBaseUnits(amount: string, decimals = TOKEN_DECIMALS): bigint {
  const [whole, frac = ''] = amount.split('.');
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(frac) || frac.length > decimals) {
    throw new Error(`Invalid amount: ${amount}`);
  }
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
}

export function formatUnits(value: bigint, decimals = TOKEN_DECIMALS): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = (abs / base).toLocaleString('en-GB');
  const frac = (abs % base).toString().padStart(decimals, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

/** Derives the exact parameters published on-chain. Validates the document as it goes. */
export function deriveOnChainParams(doc: PolicyDocument): OnChainPolicyParams {
  const countries = ruleOf(doc, 'CountryAllow').params.countries;
  if (countries.length === 0 || countries.length > MAX_COUNTRIES) {
    throw new Error(`CountryAllow must list between 1 and ${MAX_COUNTRIES} jurisdictions`);
  }
  const numeric = countries.map((c) => {
    const n = ISO_NUMERIC[c];
    if (!n) throw new Error(`Unknown jurisdiction code: ${c}`);
    return n;
  });
  while (numeric.length < MAX_COUNTRIES) numeric.push(0);

  const classes = ruleOf(doc, 'InvestorClassAllow').params.classes;
  const mask = classes.reduce((m, c) => {
    const bit = INVESTOR_CLASS[c];
    if (bit === undefined) throw new Error(`Unknown investor class: ${c}`);
    return m | (1 << bit);
  }, 0);

  const effectiveFrom = Date.parse(doc.effectiveFrom);
  if (Number.isNaN(effectiveFrom)) throw new Error(`Invalid effectiveFrom: ${doc.effectiveFrom}`);

  return {
    allowedCountries: numeric as OnChainPolicyParams['allowedCountries'],
    allowedClassMask: mask,
    maxHolderBalance: toBaseUnits(ruleOf(doc, 'MaxBalance').params.maxHolderBalance, doc.asset.decimals),
    effectiveFrom: BigInt(Math.floor(effectiveFrom / 1000)),
  };
}
