import { Barretenberg, UltraHonkBackend } from '@aztec/bb.js';
import { Noir, type CompiledCircuit, type InputMap } from '@noir-lang/noir_js';
import { readFileSync } from 'node:fs';
import { bytesToHex, type Address, type Hex } from 'viem';
import { fieldHex, fieldToBytes, bytesToField, type CredentialAttributes, type MembershipWitness, type Poseidon2 } from '@pc/shared';

const ARTIFACT_URL = new URL('../target/eligibility.json', import.meta.url);

/** Public inputs, in the exact order the circuit (and ComplianceGate) declare them. */
export interface EligibilityPublicInputs {
  registryRoot: bigint;
  allowedCountries: number[];
  allowedClassMask: number;
  now: bigint;
  holder: Address;
  binding: Hex;
}

export interface EligibilityWitnessInputs {
  credential: CredentialAttributes;
  membership: MembershipWitness;
}

export interface GeneratedProof {
  proof: Hex;
  publicInputs: Hex[];
  provingMs: number;
}

/** Thrown when the holder's private data does not satisfy the policy: no proof can exist. */
export class UnprovableStatementError extends Error {
  constructor(readonly reason: string) {
    super(`Cannot construct proof: ${reason}`);
    this.name = 'UnprovableStatementError';
  }
}

export function loadCircuit(): CompiledCircuit {
  return JSON.parse(readFileSync(ARTIFACT_URL, 'utf8')) as CompiledCircuit;
}

export function poseidon2From(bb: Barretenberg): Poseidon2 {
  return async (inputs) => {
    const { hash } = await bb.poseidon2Hash({ inputs: inputs.map(fieldToBytes) });
    return bytesToField(hash);
  };
}

/**
 * Generates and locally verifies UltraHonk proofs for the eligibility circuit.
 * Proofs target the EVM verifier (keccak transcript, zero-knowledge enabled).
 */
export class EligibilityProver {
  private constructor(
    private readonly noir: Noir,
    private readonly backend: UltraHonkBackend,
    readonly bb: Barretenberg,
  ) {}

  static async create(bb?: Barretenberg): Promise<EligibilityProver> {
    const api = bb ?? (await Barretenberg.new());
    const circuit = loadCircuit();
    return new EligibilityProver(new Noir(circuit), new UltraHonkBackend(circuit.bytecode, api), api);
  }

  static toInputMap(priv: EligibilityWitnessInputs, pub: EligibilityPublicInputs): InputMap {
    return {
      salt: fieldHex(priv.credential.salt),
      country: fieldHex(BigInt(priv.credential.country)),
      investor_class: priv.credential.investorClass,
      expiry: priv.credential.expiry.toString(),
      leaf_index: fieldHex(BigInt(priv.membership.leafIndex)),
      merkle_path: priv.membership.path.map(fieldHex),
      registry_root: fieldHex(pub.registryRoot),
      allowed_countries: pub.allowedCountries.map((c) => fieldHex(BigInt(c))),
      allowed_class_mask: pub.allowedClassMask,
      now: pub.now.toString(),
      holder: fieldHex(BigInt(pub.holder)),
      binding: pub.binding,
    };
  }

  /** Executes the circuit. Throws UnprovableStatementError if any constraint fails. */
  async witness(priv: EligibilityWitnessInputs, pub: EligibilityPublicInputs): Promise<Uint8Array> {
    try {
      const { witness } = await this.noir.execute(EligibilityProver.toInputMap(priv, pub));
      return witness;
    } catch (err) {
      throw new UnprovableStatementError(extractAssertion(err));
    }
  }

  async prove(priv: EligibilityWitnessInputs, pub: EligibilityPublicInputs): Promise<GeneratedProof> {
    const witness = await this.witness(priv, pub);
    const started = performance.now();
    const { proof, publicInputs } = await this.backend.generateProof(witness, { verifierTarget: 'evm' });
    const provingMs = Math.round(performance.now() - started);
    return { proof: bytesToHex(proof), publicInputs: publicInputs as Hex[], provingMs };
  }

  async verify(p: GeneratedProof): Promise<boolean> {
    const proof = Uint8Array.from(Buffer.from(p.proof.slice(2), 'hex'));
    return this.backend.verifyProof({ proof, publicInputs: p.publicInputs }, { verifierTarget: 'evm' });
  }

  async destroy(): Promise<void> {
    await this.bb.destroy();
  }
}

function extractAssertion(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  const known = [
    'credential not in registry',
    'jurisdiction not permitted',
    'investor class not permitted',
    'credential expired',
    'invalid investor class',
    'missing binding',
  ];
  return known.find((k) => text.includes(k)) ?? text.split('\n')[0];
}
