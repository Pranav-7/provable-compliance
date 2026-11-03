// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title CredentialRegistry
/// @notice Layer 2. Anchors the root of the issuer's credential tree. Only the
///         root is public: which holders are in the tree, and their attributes,
///         stay with the issuer and the holders themselves.
/// @dev Revoking a credential removes its leaf and publishes a new root. Every
///      eligibility proof must be built against the current root, so a revoked
///      holder can no longer prove anything, whichever node they transact through.
contract CredentialRegistry is Ownable {
    bytes32 public root;
    uint64 public epoch;
    uint64 public updatedAt;

    event RootUpdated(uint64 indexed epoch, bytes32 root, string reason);

    error EmptyRoot();

    constructor(address issuer) Ownable(issuer) {}

    function updateRoot(bytes32 newRoot, string calldata reason) external onlyOwner {
        if (newRoot == bytes32(0)) revert EmptyRoot();
        root = newRoot;
        unchecked {
            epoch += 1;
        }
        updatedAt = uint64(block.timestamp);
        emit RootUpdated(epoch, newRoot, reason);
    }
}
