import { Barretenberg } from '@aztec/bb.js';
import { getAddress, type Address, type Hex } from 'viem';
import { poseidon2From } from '@pc/circuits';
import {
  CredentialTree,
  HOLDERS,
  INVESTOR_CLASS,
  ISO_NUMERIC,
  credentialLeaf,
  deriveOnChainParams,
  fieldHex,
  policyHash,
  randomField,
  type CaseConfig,
  type CredentialAttributes,
  type HolderId,
  type MembershipWitness,
  type PolicyDocument,
  type PolicyState,
  type RegistryState,
} from '@pc/shared';
import { privateKeyToAccount } from 'viem/accounts';
import { DEV_PRIVATE_KEYS } from '@pc/shared';
import type { Chain } from './chain';

const CREDENTIAL_VALIDITY_SECONDS = 365n * 24n * 3600n;

/** The issuer's private KYC record for a client. Never leaves the bank except to its holder. */
export interface KycRecord {
  holderId: HolderId;
  address: Address;
  country: string;
  investorClass: keyof typeof INVESTOR_CLASS;
  expiry: bigint;
  salt: bigint;
  leafIndex: number;
  leaf: bigint;
  status: 'active' | 'revoked';
  revocationReason?: string;
}

export interface IssuedCredential {
  holderId: HolderId;
  attributes: CredentialAttributes;
  witness: MembershipWitness;
  epoch: number;
}

export const holderAddress = (id: HolderId): Address => privateKeyToAccount(DEV_PRIVATE_KEYS[HOLDERS[id].account]).address;

/**
 * Issuer desk: publishes the policy, runs KYC-backed credential issuance and
 * revocation, and anchors the credential registry root on-chain.
 */
export class IssuerService {
  private tree!: CredentialTree;
  private records = new Map<HolderId, KycRecord>();
  private policyState: PolicyState | null = null;
  private registryState: RegistryState | null = null;

  private constructor(
    private readonly chain: Chain,
    private readonly bb: Barretenberg,
    readonly study: CaseConfig,
  ) {}

  static async create(chain: Chain, study: CaseConfig): Promise<IssuerService> {
    const bb = await Barretenberg.new({ skipSrsInit: true });
    const svc = new IssuerService(chain, bb, study);
    await svc.reset();
    return svc;
  }

  async reset(): Promise<void> {
    this.tree = await CredentialTree.create(poseidon2From(this.bb));
    this.records.clear();
    this.policyState = null;
    this.registryState = null;
  }

  get policy(): PolicyState | null {
    return this.policyState;
  }

  get registry(): RegistryState | null {
    return this.registryState;
  }

  get policyDocument(): PolicyDocument {
    return this.study.policy;
  }

  record(id: HolderId): KycRecord | undefined {
    return this.records.get(id);
  }

  recordByAddress(address: Address): KycRecord | undefined {
    const a = getAddress(address);
    return [...this.records.values()].find((r) => r.address === a);
  }

  holderIdOf(address: Address): HolderId | undefined {
    const a = getAddress(address);
    return this.study.holders.find((id) => holderAddress(id) === a);
  }

  /** Layer 1: publish the canonical policy fingerprint and its machine parameters. */
  async publishPolicy(): Promise<PolicyState> {
    if (this.policyState) return this.policyState;
    const doc = this.study.policy;
    const p = deriveOnChainParams(doc);
    const hash = policyHash(doc);
    const { addresses } = this.chain;
    const receipt = await this.chain.write(addresses.policyRegistry, 'PolicyRegistry', 'publish', [
      doc.version,
      hash,
      p.allowedCountries,
      p.allowedClassMask,
      p.maxHolderBalance,
      p.effectiveFrom,
    ]);
    const block = await this.chain.publicClient.getBlock({ blockNumber: receipt.blockNumber });
    this.policyState = {
      version: doc.version,
      documentHash: hash,
      allowedCountries: [...p.allowedCountries],
      allowedClassMask: p.allowedClassMask,
      maxHolderBalance: p.maxHolderBalance.toString(),
      effectiveFrom: Number(p.effectiveFrom),
      publishedAt: Number(block.timestamp),
      txHash: receipt.transactionHash,
      blockNumber: Number(receipt.blockNumber),
    };
    return this.policyState;
  }

  /** Layer 2: KYC every client and commit their credentials to the registry. */
  async issueCredentials(): Promise<RegistryState> {
    if (!this.policyState) throw new Error('Publish the policy before issuing credentials');
    const hash = poseidon2From(this.bb);
    const now = BigInt(Math.floor(Date.now() / 1000));
    for (const [index, id] of this.study.holders.entries()) {
      if (this.records.has(id)) continue;
      const profile = HOLDERS[id];
      const address = holderAddress(id);
      const attributes: CredentialAttributes = {
        salt: randomField(),
        holder: BigInt(address),
        country: ISO_NUMERIC[profile.country],
        investorClass: INVESTOR_CLASS[profile.investorClass],
        expiry: now + CREDENTIAL_VALIDITY_SECONDS,
      };
      const leaf = await credentialLeaf(hash, attributes);
      await this.tree.set(index, leaf);
      this.records.set(id, {
        holderId: id,
        address,
        country: profile.country,
        investorClass: profile.investorClass,
        expiry: attributes.expiry,
        salt: attributes.salt,
        leafIndex: index,
        leaf,
        status: 'active',
      });
    }
    return this.anchorRoot(`Credentials issued to ${this.records.size} KYC-verified participants`);
  }

  /** Revocation: zero the holder's leaf and publish the new root. */
  async revoke(id: HolderId, reason: string): Promise<RegistryState> {
    const rec = this.records.get(id);
    if (!rec) throw new Error(`${id} holds no credential`);
    if (rec.status === 'revoked') return this.registryState!;
    await this.tree.clear(rec.leafIndex);
    rec.status = 'revoked';
    rec.revocationReason = reason;
    return this.anchorRoot(`${HOLDERS[id].name}: ${reason}`);
  }

  /** Hands a holder their own credential and a fresh membership witness. */
  credentialFor(id: HolderId): IssuedCredential {
    const rec = this.records.get(id);
    if (!rec) throw new Error(`${id} holds no credential`);
    if (rec.status !== 'active') throw new Error(`Credential for ${id} has been revoked`);
    return {
      holderId: id,
      attributes: {
        salt: rec.salt,
        holder: BigInt(rec.address),
        country: ISO_NUMERIC[rec.country],
        investorClass: INVESTOR_CLASS[rec.investorClass],
        expiry: rec.expiry,
      },
      witness: this.tree.witness(rec.leafIndex),
      epoch: this.registryState?.epoch ?? 0,
    };
  }

  /** Subscription: mint units to a holder with a current receive pass. */
  async issueUnits(id: HolderId, amount: bigint): Promise<Hex> {
    const receipt = await this.chain.write(this.chain.addresses.token, 'CompliantToken', 'issue', [holderAddress(id), amount]);
    return receipt.transactionHash;
  }

  private async anchorRoot(reason: string): Promise<RegistryState> {
    const root = fieldHex(this.tree.root);
    const receipt = await this.chain.write(this.chain.addresses.credentialRegistry, 'CredentialRegistry', 'updateRoot', [root, reason]);
    const epoch = await this.chain.read<bigint>(this.chain.addresses.credentialRegistry, 'CredentialRegistry', 'epoch');
    this.registryState = {
      root,
      epoch: Number(epoch),
      members: [...this.records.values()].map((r) => ({
        holderId: r.holderId,
        leafIndex: r.leafIndex,
        leaf: r.status === 'active' ? fieldHex(r.leaf) : fieldHex(0n),
        status: r.status,
      })),
      lastTxHash: receipt.transactionHash,
      lastReason: reason,
    };
    return this.registryState;
  }

  async destroy(): Promise<void> {
    await this.bb.destroy();
  }
}
