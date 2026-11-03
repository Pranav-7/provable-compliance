/** BN254 scalar field modulus. Every public input to the circuit is reduced into this field. */
export const FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Depth of the issuer's credential tree (2^8 = 256 holders). Must match the circuit. */
export const CREDENTIAL_TREE_DEPTH = 8;

/** Number of jurisdiction slots in a policy. Must match the circuit and PolicyRegistry. */
export const MAX_COUNTRIES = 4;

/** ISO 3166-1 alpha-2 to numeric. Only the jurisdictions used by the demo are listed. */
export const ISO_NUMERIC: Record<string, number> = {
  CH: 756,
  SG: 702,
  GB: 826,
  US: 840,
  DE: 276,
  JP: 392,
};

export const COUNTRY_NAMES: Record<string, string> = {
  CH: 'Switzerland',
  SG: 'Singapore',
  GB: 'United Kingdom',
  US: 'United States',
  DE: 'Germany',
  JP: 'Japan',
};

/** Investor classes, encoded as bit positions in the policy's class mask. */
export const INVESTOR_CLASS = {
  retail: 1,
  professional: 2,
  institutional: 3,
  /** Licensed credit institution (interbank case study). */
  bank: 4,
  /** Regulated non-bank, e.g. a payments firm. */
  corporate: 5,
} as const;

export type InvestorClassName = keyof typeof INVESTOR_CLASS;

/** Token has 2 decimals: 1 unit = 100 base units. */
export const TOKEN_DECIMALS = 2;

/** Domain separators, mirrored from ComplianceGate.sol. */
export const TRANSFER_DOMAIN_TAG = 'ProvableCompliance.Transfer.v2';
export const RECEIVE_DOMAIN_TAG = 'ProvableCompliance.ReceivePass.v1';
