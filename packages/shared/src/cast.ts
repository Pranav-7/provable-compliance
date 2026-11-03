import type { InvestorClassName } from './constants';

export type HolderId =
  // Case study 1: client transfers of a tokenised money market fund
  | 'alice'
  | 'bob'
  | 'carol'
  | 'dave'
  // Case study 2: interbank settlement of a tokenised deposit
  | 'treasury'
  | 'partner'
  | 'regional'
  | 'payments';

export interface Participant {
  id: HolderId | 'issuer' | 'auditor';
  name: string;
  role: string;
  /** Index into the local chain's well-known development accounts. */
  account?: number;
}

export interface HolderProfile extends Participant {
  id: HolderId;
  account: number;
  country: string;
  investorClass: InvestorClassName;
}

export const ISSUER: Participant = { id: 'issuer', name: 'Issuing Bank', role: 'Issuer and transfer agent', account: 0 };
export const AUDITOR: Participant = { id: 'auditor', name: 'Auditor', role: 'External auditor acting for the supervisor' };

export const HOLDERS: Record<HolderId, HolderProfile> = {
  alice: { id: 'alice', name: 'Alice', role: 'Professional investor', account: 1, country: 'CH', investorClass: 'professional' },
  bob: { id: 'bob', name: 'Bob', role: 'Institutional investor', account: 2, country: 'SG', investorClass: 'institutional' },
  carol: { id: 'carol', name: 'Carol', role: 'Professional investor', account: 3, country: 'GB', investorClass: 'professional' },
  dave: { id: 'dave', name: 'Dave', role: 'Retail investor', account: 4, country: 'GB', investorClass: 'retail' },
  treasury: { id: 'treasury', name: 'Issuing Bank Treasury', role: 'Licensed bank', account: 5, country: 'CH', investorClass: 'bank' },
  partner: { id: 'partner', name: 'Partner Bank', role: 'Licensed bank', account: 6, country: 'JP', investorClass: 'bank' },
  regional: { id: 'regional', name: 'Regional Bank', role: 'Licensed bank', account: 7, country: 'SG', investorClass: 'bank' },
  payments: { id: 'payments', name: 'Payments Firm', role: 'Regulated non-bank', account: 8, country: 'GB', investorClass: 'corporate' },
};

export const HOLDER_IDS = Object.keys(HOLDERS) as HolderId[];

/**
 * Hardhat's public development mnemonic ("test test ... junk"), accounts 0 to 8.
 * These keys are published in Hardhat's documentation and must never hold real value.
 */
export const DEV_PRIVATE_KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
  '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
  '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e',
  '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356',
  '0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97',
] as const;
