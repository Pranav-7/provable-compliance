import type { PolicyDocument, PolicyRule } from './policy';

const AUDIT_DISCLOSURE: PolicyRule = {
  id: 'R7',
  type: 'AuditDisclosure',
  description: 'Every transfer carries the holder\'s credential data encrypted to the auditor, bound into the proof so it cannot be swapped.',
  enforcement: 'on-chain',
  params: { recipient: 'Supervisory auditor', scheme: 'X25519 · HKDF-SHA256 · ChaCha20-Poly1305' },
};

/**
 * Version 12 of the illustrative dMMF transfer policy.
 * All identifiers are placeholders: this is not a real issuer, fund or rulebook.
 */
export const POLICY_V12: PolicyDocument = {
  schema: 'provable-compliance/transfer-policy@1',
  policyId: 'DMMF-TRANSFER',
  version: 12,
  status: 'illustrative',
  issuer: { name: 'Issuing Bank (demo)', lei: 'DEMO00ISSUINGBANK001' },
  asset: {
    name: 'Demo MMF Token',
    symbol: 'dMMF',
    type: 'money-market-fund-unit',
    identifier: 'DEMO-DMMF-0001',
    decimals: 2,
  },
  effectiveFrom: '2026-11-01T00:00:00Z',
  references: [
    'ERC-3643 modular compliance (CountryAllow, MaxBalance)',
    'CMTA RuleEngine (whitelist and sanctions-list rules)',
    'W3C Verifiable Credentials data model 2.0',
  ],
  rules: [
    {
      id: 'R1',
      type: 'CountryAllow',
      description: 'Holder jurisdiction must be on the allow list.',
      enforcement: 'zk-proof',
      params: { countries: ['CH', 'SG', 'GB'] },
    },
    {
      id: 'R2',
      type: 'InvestorClassAllow',
      description: 'Only professional and institutional investors may hold or receive units.',
      enforcement: 'zk-proof',
      params: { classes: ['professional', 'institutional'] },
    },
    {
      id: 'R3',
      type: 'SanctionsScreen',
      description: 'Sanctioned holders are removed from the credential registry and can no longer prove eligibility.',
      enforcement: 'credential-revocation',
      params: { list: 'Demo consolidated sanctions list', listVersion: '2026-10-30' },
    },
    {
      id: 'R4',
      type: 'CredentialValidity',
      description: 'The holder credential must not have expired.',
      enforcement: 'zk-proof',
      params: { requireUnexpired: true },
    },
    {
      id: 'R5',
      type: 'MaxBalance',
      description: 'No single holder may exceed the balance cap after a transfer.',
      enforcement: 'on-chain',
      params: { maxHolderBalance: '25000.00' },
    },
    {
      id: 'R6',
      type: 'RecipientEligibility',
      description: 'The recipient must hold a current eligibility pass against the latest registry root.',
      enforcement: 'on-chain',
      params: { requireReceivePass: true },
    },
    AUDIT_DISCLOSURE,
  ],
  approval: { role: 'Head of Compliance (demo)', date: '2026-10-30' },
};

/**
 * Version 1 of the illustrative interbank settlement policy for a tokenised
 * deposit. Participants are bank treasuries; the cap acts as a bilateral
 * exposure limit. All identifiers are placeholders.
 */
export const POLICY_INTERBANK_V1: PolicyDocument = {
  schema: 'provable-compliance/transfer-policy@1',
  policyId: 'DDEP-INTERBANK',
  version: 1,
  status: 'illustrative',
  issuer: { name: 'Issuing Bank (demo)', lei: 'DEMO00ISSUINGBANK001' },
  asset: {
    name: 'Demo Deposit Token',
    symbol: 'dDEP',
    type: 'tokenised-deposit',
    identifier: 'DEMO-DDEP-0001',
    decimals: 2,
  },
  effectiveFrom: '2026-11-01T00:00:00Z',
  references: [
    'ERC-3643 modular compliance (CountryAllow, MaxBalance)',
    'CMTA RuleEngine (whitelist and sanctions-list rules)',
    'W3C Verifiable Credentials data model 2.0',
  ],
  rules: [
    {
      id: 'R1',
      type: 'CountryAllow',
      description: 'Participant bank must be licensed in a permitted jurisdiction.',
      enforcement: 'zk-proof',
      params: { countries: ['CH', 'JP', 'SG', 'GB'] },
    },
    {
      id: 'R2',
      type: 'InvestorClassAllow',
      description: 'Only licensed credit institutions may hold or receive the deposit token.',
      enforcement: 'zk-proof',
      params: { classes: ['bank'] },
    },
    {
      id: 'R3',
      type: 'SanctionsScreen',
      description: 'Sanctioned institutions are removed from the participant registry and can no longer prove eligibility.',
      enforcement: 'credential-revocation',
      params: { list: 'Demo consolidated sanctions list', listVersion: '2026-10-30' },
    },
    {
      id: 'R4',
      type: 'CredentialValidity',
      description: 'The participant credential (counterparty due diligence) must not have expired.',
      enforcement: 'zk-proof',
      params: { requireUnexpired: true },
    },
    {
      id: 'R5',
      type: 'MaxBalance',
      description: 'Bilateral exposure limit: no participant may hold more than the cap after a transfer.',
      enforcement: 'on-chain',
      params: { maxHolderBalance: '10000000.00' },
    },
    {
      id: 'R6',
      type: 'RecipientEligibility',
      description: 'The receiving bank must hold a current eligibility pass against the latest registry root.',
      enforcement: 'on-chain',
      params: { requireReceivePass: true },
    },
    AUDIT_DISCLOSURE,
  ],
  approval: { role: 'Head of Treasury Compliance (demo)', date: '2026-10-30' },
};
