import { Barretenberg } from '@aztec/bb.js';
import { encodeAbiParameters, keccak256, type Hex } from 'viem';
import { EligibilityProver, type EligibilityPublicInputs, type EligibilityWitnessInputs, type GeneratedProof } from '@pc/circuits';
import { fieldHex } from '@pc/shared';

export interface ProofSystem {
  readonly kind: 'ultrahonk' | 'dev';
  prove(priv: EligibilityWitnessInputs, pub: EligibilityPublicInputs): Promise<GeneratedProof>;
  destroy(): Promise<void>;
}

/** Real zero-knowledge proofs (UltraHonk over BN254), verified on-chain by HonkVerifier. */
export class UltraHonkProofSystem implements ProofSystem {
  readonly kind = 'ultrahonk' as const;
  private constructor(private readonly prover: EligibilityProver) {}

  static async create(): Promise<UltraHonkProofSystem> {
    return new UltraHonkProofSystem(await EligibilityProver.create(await Barretenberg.new()));
  }

  prove(priv: EligibilityWitnessInputs, pub: EligibilityPublicInputs): Promise<GeneratedProof> {
    return this.prover.prove(priv, pub);
  }

  destroy(): Promise<void> {
    return this.prover.destroy();
  }
}

/**
 * Development proof system for CI environments without access to the public
 * trusted setup. It still executes the circuit, so every policy constraint is
 * enforced exactly as in production; only the succinct proof is replaced by a
 * commitment that the contracts' MockVerifier accepts. Never used by `npm start`.
 */
export class DevProofSystem implements ProofSystem {
  readonly kind = 'dev' as const;
  private constructor(private readonly prover: EligibilityProver) {}

  static async create(): Promise<DevProofSystem> {
    return new DevProofSystem(await EligibilityProver.create(await Barretenberg.new({ skipSrsInit: true })));
  }

  async prove(priv: EligibilityWitnessInputs, pub: EligibilityPublicInputs): Promise<GeneratedProof> {
    const started = performance.now();
    await this.prover.witness(priv, pub);
    const publicInputs: Hex[] = [
      fieldHex(pub.registryRoot),
      ...pub.allowedCountries.map((c) => fieldHex(BigInt(c))),
      fieldHex(BigInt(pub.allowedClassMask)),
      fieldHex(pub.now),
      fieldHex(BigInt(pub.holder)),
      pub.binding,
    ];
    const proof = encodeAbiParameters([{ type: 'bytes32' }], [keccak256(encodeAbiParameters([{ type: 'bytes32[]' }], [publicInputs]))]);
    return { proof, publicInputs, provingMs: Math.round(performance.now() - started) };
  }

  destroy(): Promise<void> {
    return this.prover.destroy();
  }
}
