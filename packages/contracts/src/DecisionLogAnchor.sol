// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title DecisionLogAnchor
/// @notice Layer 4. Anchors Merkle roots of the issuer's compliance decision log,
///         including blocked attempts. Any later change to any record changes the
///         root, and a single record can be proven to an auditor without revealing
///         any other decision.
/// @dev Leaves follow the OpenZeppelin StandardMerkleTree convention
///      (double keccak of the ABI-encoded record) and pairs are hashed sorted.
contract DecisionLogAnchor is Ownable {
    struct Batch {
        bytes32 root;
        uint32 firstSeq;
        uint32 count;
        uint64 anchoredAt;
    }

    Batch[] private _batches;

    event BatchAnchored(uint256 indexed batchId, bytes32 indexed root, uint32 firstSeq, uint32 count);

    error EmptyBatch();
    error UnknownBatch(uint256 batchId);

    constructor(address issuer) Ownable(issuer) {}

    function anchor(bytes32 root, uint32 firstSeq, uint32 count) external onlyOwner returns (uint256 batchId) {
        if (root == bytes32(0) || count == 0) revert EmptyBatch();
        batchId = _batches.length;
        _batches.push(Batch(root, firstSeq, count, uint64(block.timestamp)));
        emit BatchAnchored(batchId, root, firstSeq, count);
    }

    function batchCount() external view returns (uint256) {
        return _batches.length;
    }

    function batch(uint256 batchId) external view returns (Batch memory) {
        if (batchId >= _batches.length) revert UnknownBatch(batchId);
        return _batches[batchId];
    }

    /// @notice Checks that `leaf` is part of an anchored batch.
    function verifyRecord(uint256 batchId, bytes32 leaf, bytes32[] calldata proof) external view returns (bool) {
        if (batchId >= _batches.length) revert UnknownBatch(batchId);
        return MerkleProof.verifyCalldata(proof, _batches[batchId].root, leaf);
    }
}
