// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {PolicyRegistry} from "./PolicyRegistry.sol";
import {CredentialRegistry} from "./CredentialRegistry.sol";
import {IProofVerifier} from "./interfaces/IProofVerifier.sol";

/// @title ComplianceGate
/// @notice Layer 3. The token's compliance hook (in the spirit of ERC-3643's
///         modular compliance). Every transfer must carry a zero-knowledge proof
///         that the sender satisfies the active policy, and the recipient must hold
///         a current eligibility pass. Because the token itself calls this gate,
///         the rule holds no matter which node or RPC the transaction came through.
contract ComplianceGate is Ownable {
    /// @dev BN254 scalar field modulus; public inputs must be field elements.
    uint256 internal constant FIELD_MODULUS =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    /// @dev How far behind the block time a proof's `validAt` may be.
    uint256 public constant MAX_PROOF_AGE = 1 hours;
    uint256 internal constant PUBLIC_INPUTS = 9;

    bytes32 internal constant TRANSFER_DOMAIN = keccak256("ProvableCompliance.Transfer.v2");
    bytes32 internal constant RECEIVE_DOMAIN = keccak256("ProvableCompliance.ReceivePass.v1");

    PolicyRegistry public immutable policies;
    CredentialRegistry public immutable credentials;
    IProofVerifier public immutable verifier;
    address public token;

    /// Registry epoch at which each holder last proved receive eligibility.
    mapping(address holder => uint64 epoch) public receivePassEpoch;
    /// Per-sender nonce, folded into each transfer binding to prevent proof replay.
    mapping(address holder => uint256) public transferNonce;

    event ReceivePassRegistered(address indexed holder, uint64 indexed epoch);
    event TransferAuthorized(
        address indexed from,
        address indexed to,
        uint256 amount,
        uint32 policyVersion,
        uint64 registryEpoch,
        bytes32 proofHash,
        bytes32 envelopeHash
    );

    error TokenAlreadySet();
    error OnlyToken();
    error StaleRegistryRoot(bytes32 provided, bytes32 current);
    error ProofTimestampOutOfRange(uint64 validAt, uint256 blockTime);
    error RecipientNotEligible(address recipient);
    error MaxBalanceExceeded(address recipient, uint256 balanceAfter, uint256 cap);
    error InvalidProof();

    constructor(address issuer, PolicyRegistry policies_, CredentialRegistry credentials_, IProofVerifier verifier_)
        Ownable(issuer)
    {
        policies = policies_;
        credentials = credentials_;
        verifier = verifier_;
    }

    /// @notice One-time wiring of the token this gate guards.
    function bindToken(address token_) external onlyOwner {
        if (token != address(0)) revert TokenAlreadySet();
        token = token_;
    }

    // ---------------------------------------------------------------------
    // Receive eligibility
    // ---------------------------------------------------------------------

    /// @notice A holder proves, against the current registry root, that they are
    ///         eligible to receive under the active policy. The pass lapses as soon
    ///         as the registry root changes (for example after any revocation).
    function registerReceivePass(bytes32 proofRoot, uint64 validAt, bytes calldata proof) external {
        _requireCurrentRoot(proofRoot);
        _requireFreshTimestamp(validAt);
        uint64 epoch = credentials.epoch();
        _verify(msg.sender, validAt, receiveBinding(msg.sender, epoch), proof);
        receivePassEpoch[msg.sender] = epoch;
        emit ReceivePassRegistered(msg.sender, epoch);
    }

    function hasReceivePass(address holder) public view returns (bool) {
        uint64 epoch = receivePassEpoch[holder];
        return epoch != 0 && epoch == credentials.epoch();
    }

    // ---------------------------------------------------------------------
    // Transfer authorization (called by the token on every transfer)
    // ---------------------------------------------------------------------

    function authorizeTransfer(
        address from,
        address to,
        uint256 amount,
        uint256 recipientBalanceAfter,
        bytes32 proofRoot,
        uint64 validAt,
        bytes calldata proof,
        bytes32 envelopeHash
    ) external {
        if (msg.sender != token) revert OnlyToken();
        _requireCurrentRoot(proofRoot);
        _requireFreshTimestamp(validAt);
        if (!hasReceivePass(to)) revert RecipientNotEligible(to);

        PolicyRegistry.Policy memory policy = policies.active();
        if (recipientBalanceAfter > policy.maxHolderBalance) {
            revert MaxBalanceExceeded(to, recipientBalanceAfter, policy.maxHolderBalance);
        }

        uint256 nonce = transferNonce[from];
        _verifyAgainst(policy, from, validAt, transferBinding(from, to, amount, nonce, envelopeHash), proof);
        transferNonce[from] = nonce + 1;

        emit TransferAuthorized(
            from, to, amount, policies.activeVersion(), credentials.epoch(), keccak256(proof), envelopeHash
        );
    }

    // ---------------------------------------------------------------------
    // Bindings (mirrored in @pc/shared so provers compute identical values)
    // ---------------------------------------------------------------------

    function transferBinding(address from, address to, uint256 amount, uint256 nonce, bytes32 envelopeHash)
        public
        view
        returns (bytes32)
    {
        return _toField(keccak256(abi.encode(TRANSFER_DOMAIN, block.chainid, token, from, to, amount, nonce, envelopeHash)));
    }

    function receiveBinding(address holder, uint64 epoch) public view returns (bytes32) {
        return _toField(keccak256(abi.encode(RECEIVE_DOMAIN, block.chainid, address(this), holder, epoch)));
    }

    /// @notice The exact public-input vector a proof for `holder` must satisfy.
    function publicInputs(address holder, uint64 validAt, bytes32 binding) public view returns (bytes32[] memory) {
        return _publicInputs(policies.active(), holder, validAt, binding);
    }

    /// @notice Public inputs for a given registry root and policy version, for auditors
    ///         re-verifying a historical proof (including proofs against superseded roots).
    function publicInputsFor(bytes32 root, uint32 policyVersion, address holder, uint64 validAt, bytes32 binding)
        external
        view
        returns (bytes32[] memory inputs)
    {
        inputs = _publicInputs(policies.policyAt(policyVersion), holder, validAt, binding);
        inputs[0] = root;
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _verify(address holder, uint64 validAt, bytes32 binding, bytes calldata proof) internal view {
        _verifyAgainst(policies.active(), holder, validAt, binding, proof);
    }

    function _verifyAgainst(
        PolicyRegistry.Policy memory policy,
        address holder,
        uint64 validAt,
        bytes32 binding,
        bytes calldata proof
    ) internal view {
        bytes32[] memory inputs = _publicInputs(policy, holder, validAt, binding);
        bool ok;
        try verifier.verify(proof, inputs) returns (bool result) {
            ok = result;
        } catch {
            ok = false;
        }
        if (!ok) revert InvalidProof();
    }

    function _publicInputs(PolicyRegistry.Policy memory policy, address holder, uint64 validAt, bytes32 binding)
        internal
        view
        returns (bytes32[] memory inputs)
    {
        // Order must match the circuit's `pub` parameters exactly.
        inputs = new bytes32[](PUBLIC_INPUTS);
        inputs[0] = credentials.root();
        for (uint256 i = 0; i < 4; i++) {
            inputs[1 + i] = bytes32(uint256(policy.allowedCountries[i]));
        }
        inputs[5] = bytes32(uint256(policy.allowedClassMask));
        inputs[6] = bytes32(uint256(validAt));
        inputs[7] = bytes32(uint256(uint160(holder)));
        inputs[8] = binding;
    }

    function _requireCurrentRoot(bytes32 proofRoot) internal view {
        bytes32 current = credentials.root();
        if (proofRoot != current) revert StaleRegistryRoot(proofRoot, current);
    }

    function _requireFreshTimestamp(uint64 validAt) internal view {
        if (validAt > block.timestamp + 5 minutes || block.timestamp > uint256(validAt) + MAX_PROOF_AGE) {
            revert ProofTimestampOutOfRange(validAt, block.timestamp);
        }
    }

    function _toField(bytes32 h) internal pure returns (bytes32) {
        return bytes32(uint256(h) % FIELD_MODULUS);
    }
}
