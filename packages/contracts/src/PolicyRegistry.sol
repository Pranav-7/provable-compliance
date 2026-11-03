// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title PolicyRegistry
/// @notice Layer 1. Publishes each version of the issuer's transfer policy as an
///         immutable record: the hash of the full human-readable policy document,
///         plus the machine-checkable parameters every eligibility proof is bound to.
/// @dev Parameters are what the ZK verifier feeds in as public inputs, so a holder
///      cannot prove eligibility against parameters of their own choosing.
contract PolicyRegistry is Ownable {
    uint256 public constant MAX_COUNTRIES = 4;

    struct Policy {
        /// keccak256 of the RFC 8785 canonical JSON policy document.
        bytes32 documentHash;
        /// ISO 3166-1 numeric jurisdiction codes; zero entries are unused slots.
        uint16[MAX_COUNTRIES] allowedCountries;
        /// Bit i set => investor class i is permitted.
        uint8 allowedClassMask;
        /// Per-holder balance cap, in token base units.
        uint256 maxHolderBalance;
        /// Unix time from which this version governs transfers.
        uint64 effectiveFrom;
        /// Block timestamp at which it was published.
        uint64 publishedAt;
    }

    mapping(uint32 version => Policy) private _policies;
    uint32 public activeVersion;

    event PolicyPublished(uint32 indexed version, bytes32 indexed documentHash, uint64 effectiveFrom);

    error VersionNotIncreasing(uint32 current, uint32 proposed);
    error EmptyDocumentHash();
    error NoActivePolicy();
    error UnknownVersion(uint32 version);

    constructor(address issuer) Ownable(issuer) {}

    /// @notice Publishes a new policy version. Versions are append-only and strictly increasing.
    function publish(
        uint32 version,
        bytes32 documentHash,
        uint16[MAX_COUNTRIES] calldata allowedCountries,
        uint8 allowedClassMask,
        uint256 maxHolderBalance,
        uint64 effectiveFrom
    ) external onlyOwner {
        if (version <= activeVersion) revert VersionNotIncreasing(activeVersion, version);
        if (documentHash == bytes32(0)) revert EmptyDocumentHash();

        _policies[version] = Policy({
            documentHash: documentHash,
            allowedCountries: allowedCountries,
            allowedClassMask: allowedClassMask,
            maxHolderBalance: maxHolderBalance,
            effectiveFrom: effectiveFrom,
            publishedAt: uint64(block.timestamp)
        });
        activeVersion = version;
        emit PolicyPublished(version, documentHash, effectiveFrom);
    }

    function active() external view returns (Policy memory) {
        if (activeVersion == 0) revert NoActivePolicy();
        return _policies[activeVersion];
    }

    function policyAt(uint32 version) external view returns (Policy memory) {
        Policy memory p = _policies[version];
        if (p.documentHash == bytes32(0)) revert UnknownVersion(version);
        return p;
    }
}
