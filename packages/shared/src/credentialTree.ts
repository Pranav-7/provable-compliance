import { CREDENTIAL_TREE_DEPTH } from './constants';

/** A Poseidon2 hash over field elements. Injected so this module stays runtime-agnostic. */
export type Poseidon2 = (inputs: bigint[]) => Promise<bigint>;

export interface CredentialAttributes {
  salt: bigint;
  holder: bigint;
  country: number;
  investorClass: number;
  expiry: bigint;
}

export interface MembershipWitness {
  leafIndex: number;
  path: bigint[];
  root: bigint;
}

/** Leaf commitment. Must match `credential_leaf` in the eligibility circuit. */
export function credentialLeaf(hash: Poseidon2, c: CredentialAttributes): Promise<bigint> {
  return hash([c.salt, c.holder, BigInt(c.country), BigInt(c.investorClass), c.expiry]);
}

/**
 * Fixed-depth sparse Merkle tree of credential commitments, hashed with Poseidon2.
 * Empty slots hold 0; revoking a credential zeroes its leaf, which changes the root.
 */
export class CredentialTree {
  private readonly leaves: bigint[];
  private levels: bigint[][] = [];
  private zeros: bigint[] = [];

  private constructor(
    private readonly hash: Poseidon2,
    readonly depth: number,
  ) {
    this.leaves = new Array<bigint>(2 ** depth).fill(0n);
  }

  static async create(hash: Poseidon2, depth = CREDENTIAL_TREE_DEPTH): Promise<CredentialTree> {
    const tree = new CredentialTree(hash, depth);
    tree.zeros = [0n];
    for (let i = 0; i < depth; i++) tree.zeros.push(await hash([tree.zeros[i], tree.zeros[i]]));
    await tree.rebuild();
    return tree;
  }

  get capacity(): number {
    return this.leaves.length;
  }

  get root(): bigint {
    return this.levels[this.depth][0];
  }

  leafAt(index: number): bigint {
    return this.leaves[index];
  }

  async set(index: number, leaf: bigint): Promise<void> {
    if (index < 0 || index >= this.capacity) throw new RangeError(`Leaf index ${index} out of range`);
    this.leaves[index] = leaf;
    await this.rebuild();
  }

  async clear(index: number): Promise<void> {
    await this.set(index, 0n);
  }

  witness(index: number): MembershipWitness {
    if (this.leaves[index] === 0n) throw new Error(`No credential at index ${index}`);
    const path: bigint[] = [];
    let i = index;
    for (let level = 0; level < this.depth; level++) {
      path.push(this.levels[level][i ^ 1]);
      i >>= 1;
    }
    return { leafIndex: index, path, root: this.root };
  }

  /** Recomputes the root from a leaf and its witness, exactly as the circuit does. */
  static async computeRoot(hash: Poseidon2, leaf: bigint, leafIndex: number, path: bigint[]): Promise<bigint> {
    let node = leaf;
    for (let level = 0; level < path.length; level++) {
      const bit = (leafIndex >> level) & 1;
      node = bit === 0 ? await hash([node, path[level]]) : await hash([path[level], node]);
    }
    return node;
  }

  private async rebuild(): Promise<void> {
    const levels: bigint[][] = [this.leaves.slice()];
    for (let level = 0; level < this.depth; level++) {
      const below = levels[level];
      const next: bigint[] = [];
      for (let i = 0; i < below.length; i += 2) {
        const [l, r] = [below[i], below[i + 1]];
        // Skip hashing empty subtrees: their value is known in advance.
        next.push(l === this.zeros[level] && r === this.zeros[level] ? this.zeros[level + 1] : await this.hash([l, r]));
      }
      levels.push(next);
    }
    this.levels = levels;
  }
}
