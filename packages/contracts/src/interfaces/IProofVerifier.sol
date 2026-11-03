// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Interface of the UltraHonk verifier generated from the eligibility circuit.
interface IProofVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}
