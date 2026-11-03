// Eligibility proof for a policy-governed token transfer.
//
// Statement proven (everything not marked `pub` stays private to the holder):
//
//   "I hold a credential issued to `holder` that is a leaf of the issuer's
//    current credential registry (`registry_root`). Its jurisdiction is in the
//    policy's allowed set, its investor class is permitted by the policy, it has
//    not expired at `now`, and this proof is bound to `binding`."
//
// All policy parameters are public inputs supplied by the on-chain verifier from
// the PolicyRegistry, so a proof cannot be generated against a policy of the
// holder's choosing. `binding` commits to the exact action (a specific transfer,
// or a receive-eligibility pass), so a proof cannot be replayed elsewhere.

mod poseidon2;

global TREE_DEPTH: u32 = 8;
global MAX_COUNTRIES: u32 = 4;

/// Leaf commitment for a credential. `salt` stops anyone who knows the small
/// attribute domain (countries, classes) from brute-forcing a holder's leaf.
pub fn credential_leaf(salt: Field, holder: Field, country: Field, class: Field, expiry: Field) -> Field {
    poseidon2::hash([salt, holder, country, class, expiry])
}

/// Recomputes a Merkle root from a leaf, its index and its sibling path.
pub fn compute_root(leaf: Field, index: Field, path: [Field; TREE_DEPTH]) -> Field {
    let bits: [bool; TREE_DEPTH] = index.to_le_bits();
    let mut node = leaf;
    for i in 0..TREE_DEPTH {
        node = if !bits[i] {
            poseidon2::hash([node, path[i]])
        } else {
            poseidon2::hash([path[i], node])
        };
    }
    node
}

fn main(
    // Private: the holder's credential and its registry membership witness.
    salt: Field,
    country: Field,
    investor_class: u8,
    expiry: u64,
    leaf_index: Field,
    merkle_path: [Field; TREE_DEPTH],
    // Public: chain state and policy parameters, supplied by the verifier contract.
    registry_root: pub Field,
    allowed_countries: pub [Field; MAX_COUNTRIES],
    allowed_class_mask: pub u8,
    now: pub u64,
    holder: pub Field,
    binding: pub Field,
) {
    // 1. Membership in the issuer's current registry.
    let leaf = credential_leaf(salt, holder, country, investor_class as Field, expiry as Field);
    assert(compute_root(leaf, leaf_index, merkle_path) == registry_root, "credential not in registry");

    // 2. Jurisdiction is on the policy's allow list (zero slots are padding).
    let mut country_ok = false;
    for i in 0..MAX_COUNTRIES {
        if (allowed_countries[i] != 0) & (allowed_countries[i] == country) {
            country_ok = true;
        }
    }
    assert(country_ok, "jurisdiction not permitted");

    // 3. Investor class is permitted by the policy bitmask.
    assert(investor_class < 8, "invalid investor class");
    assert(((allowed_class_mask >> investor_class) & 1) == 1, "investor class not permitted");

    // 4. Credential is still valid.
    assert(expiry > now, "credential expired");

    // 5. Bind the proof to a concrete action.
    assert(binding != 0, "missing binding");
}

#[test]
fn test_root_changes_with_leaf() {
    let path = [0; TREE_DEPTH];
    let a = compute_root(credential_leaf(1, 2, 756, 2, 9999999999), 0, path);
    let b = compute_root(credential_leaf(1, 2, 826, 2, 9999999999), 0, path);
    assert(a != b);
}
