// Poseidon2 sponge hash over the BN254 scalar field.
//
// Mirrors the reference implementation in noir-lang/poseidon (MIT/Apache-2.0):
// rate 3, capacity 1, IV = message_length * 2^64. It is bit-for-bit compatible
// with Barretenberg's `poseidon2Hash`, which the off-chain issuer uses to build
// the credential registry, so leaves and roots computed in TypeScript match the
// ones recomputed inside the circuit.

global RATE: u32 = 3;
global TWO_POW_64: Field = 18446744073709551616;

pub fn hash<let N: u32>(input: [Field; N]) -> Field {
    let mut state: [Field; 4] = [0, 0, 0, (N as Field) * TWO_POW_64];
    let mut cache: [Field; 3] = [0; 3];
    let mut cache_size: u32 = 0;

    for i in 0..N {
        if cache_size == RATE {
            for j in 0..RATE {
                state[j] += cache[j];
            }
            state = std::hash::poseidon2_permutation(state);
            cache[0] = input[i];
            cache_size = 1;
        } else {
            cache[cache_size] = input[i];
            cache_size += 1;
        }
    }

    for j in 0..RATE {
        if j < cache_size {
            state[j] += cache[j];
        }
    }
    state = std::hash::poseidon2_permutation(state);
    state[0]
}
