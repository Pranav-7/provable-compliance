// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ComplianceGate} from "./ComplianceGate.sol";

/// @title CompliantToken
/// @notice A permissioned token (here a tokenised fund unit or a tokenised
///         deposit) whose every transfer must carry a compliance proof and an
///         audit envelope. The standard ERC-20 transfer paths are closed, so units
///         move only through the gate, on whichever route the transaction arrives.
/// @dev Illustrative asset for a proof of concept. Not a real fund or deposit.
contract CompliantToken is ERC20, Ownable {
    ComplianceGate public immutable gate;

    error ProofRequired();
    error AuditEnvelopeRequired();
    error RecipientNotEligible(address recipient);

    constructor(address issuer, ComplianceGate gate_, string memory name_, string memory symbol_)
        ERC20(name_, symbol_)
        Ownable(issuer)
    {
        gate = gate_;
    }

    function decimals() public pure override returns (uint8) {
        return 2;
    }

    /// @notice Issuance (subscription or deposit). The recipient must hold a current eligibility pass.
    function issue(address to, uint256 amount) external onlyOwner {
        if (!gate.hasReceivePass(to)) revert RecipientNotEligible(to);
        _mint(to, amount);
    }

    /// @notice Redemption by the issuer on the holder's instruction.
    function redeem(address from, uint256 amount) external onlyOwner {
        _burn(from, amount);
    }

    /// @notice The only way to move units between holders.
    /// @param proofRoot     Credential registry root the proof was built against.
    /// @param validAt       Timestamp used as the proof's notion of "now".
    /// @param proof         UltraHonk proof of the sender's eligibility, bound to this transfer.
    /// @param auditEnvelope Sender's credential data encrypted to the auditor. Its hash is
    ///                      part of the proof's binding, so it cannot be swapped.
    function transferWithProof(
        address to,
        uint256 amount,
        bytes32 proofRoot,
        uint64 validAt,
        bytes calldata proof,
        bytes calldata auditEnvelope
    ) external returns (bool) {
        if (auditEnvelope.length == 0) revert AuditEnvelopeRequired();
        gate.authorizeTransfer(
            msg.sender, to, amount, balanceOf(to) + amount, proofRoot, validAt, proof, keccak256(auditEnvelope)
        );
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transfer(address, uint256) public pure override returns (bool) {
        revert ProofRequired();
    }

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        revert ProofRequired();
    }
}
