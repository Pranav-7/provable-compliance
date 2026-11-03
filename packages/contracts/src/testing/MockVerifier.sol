// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IProofVerifier} from "../interfaces/IProofVerifier.sol";

/// @notice Test double for the UltraHonk verifier. Accepts a proof iff it equals
///         keccak256(abi.encode(publicInputs)), so unit tests can exercise every
///         contract path (including public-input wiring) without a prover.
/// @dev Never deployed by the demo; used only by the contract test suite.
contract MockVerifier is IProofVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external pure returns (bool) {
        return keccak256(proof) == keccak256(abi.encode(keccak256(abi.encode(publicInputs))));
    }
}
