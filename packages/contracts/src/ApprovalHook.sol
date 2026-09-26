// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPermissionHook} from "./IPermissionHook.sol";
import {ReusablePermissionWallet} from "./ReusablePermissionWallet.sol";
import {P256} from "solady/utils/P256.sol";
import {WebAuthn} from "solady/utils/WebAuthn.sol";

/// @notice Plugin: purchases above a threshold need the owner's approval of that exact purchase, and optionally so does
/// any payment to a payee the owner hasn't approved a payment to before.
/// The threshold applies to each purchase on its own, so without the payee rule a large order split into small ones is
/// not caught (only the budget and uses bound it). The threshold is in the permission's asset units: wei for ETH cards,
/// 6-decimal units for USDC payments. An approval covers one purchase (wallet, permission, target, value and calldata),
/// once, until it expires. For x402 payments the wallet passes the payee as target and empty calldata.
///
/// Config per permission, one of:
/// - `abi.encode(uint256 threshold)`: the wallet's owner account approves with `approve`.
/// - `abi.encode(uint256 threshold, bytes32 x, bytes32 y, bytes32 rpIdHash)`: only a passkey (P-256 public key x, y,
///   e.g. Touch ID) approves, with `approveWithPasskey`; anyone may submit the signature. The owner account can't.
/// - `abi.encode(uint256 threshold, bytes32 x, bytes32 y, bytes32 rpIdHash, uint256 flags)`: passkey mode, and with
///   `UNKNOWN_PAYEES_NEED_APPROVAL` set, any purchase to a target that isn't a known payee needs approval whatever the
///   amount. A target becomes a known payee of that permission only when an approved purchase to it goes through.
contract ApprovalHook is IPermissionHook {
    error ApprovalRequired(bytes32 requestKey);
    error NotWalletOwner();
    error NotAttached();
    error InvalidExpiry();
    error PasskeyRequired();
    error NoPasskey();
    error InvalidPasskeySignature();

    event Approved(address indexed wallet, uint256 indexed permissionId, bytes32 indexed requestKey, uint64 validUntil);
    event ApprovalUsed(address indexed wallet, uint256 indexed permissionId, bytes32 indexed requestKey);
    event PayeeKnown(address indexed wallet, uint256 indexed permissionId, address indexed payee);

    /// @notice Config flag: purchases to targets that aren't known payees need approval at any amount.
    uint256 public constant UNKNOWN_PAYEES_NEED_APPROVAL = 1;

    uint64 public constant MAX_APPROVAL_TTL = 1 days;

    /// @notice requestKey => last second the approval can be used (0 = none).
    mapping(bytes32 => uint64) public approvedUntil;
    /// @notice requestKey => passkey approvals made so far. Part of the challenge, so a signature can't be replayed.
    mapping(bytes32 => uint256) public nonces;
    /// @notice wallet => permissionId => payee => an approved purchase to this payee has gone through.
    mapping(address => mapping(uint256 => mapping(address => bool))) public knownPayee;

    /// @dev Without the P-256 precompile (or solady's fallback verifier) every passkey signature would just fail.
    constructor() {
        require(P256.hasPrecompileOrVerifier(), "no P-256 verifier");
    }

    function requestKey(address wallet, uint256 permissionId, address target, uint256 value, bytes memory data)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(wallet, permissionId, target, value, keccak256(data)));
    }

    /// @notice The threshold this plugin enforces on a permission; reverts NotAttached if it isn't attached.
    function thresholdOf(address wallet, uint256 permissionId) public view returns (uint256) {
        return abi.decode(_config(wallet, permissionId), (uint256));
    }

    /// @notice Whether a purchase of `value` to `target` would need the owner's approval (before any approval exists).
    function needsApproval(address wallet, uint256 permissionId, address target, uint256 value) external view returns (bool) {
        return _needsApproval(wallet, permissionId, target, value, _config(wallet, permissionId));
    }

    /// @notice What the passkey must sign to approve this purchase until `validUntil`.
    function challenge(
        address wallet,
        uint256 permissionId,
        address target,
        uint256 value,
        bytes memory data,
        uint64 validUntil
    ) public view returns (bytes32) {
        bytes32 key = requestKey(wallet, permissionId, target, value, data);
        return keccak256(abi.encode(block.chainid, address(this), key, nonces[key], validUntil));
    }

    /// @notice The wallet's owner approves one exact purchase until `validUntil` (at most a day ahead).
    /// A fake wallet can only approve requests keyed by its own address, so it can't affect real cards.
    function approve(
        address wallet,
        uint256 permissionId,
        address target,
        uint256 value,
        bytes calldata data,
        uint64 validUntil
    ) external {
        if (msg.sender != ReusablePermissionWallet(payable(wallet)).owner()) revert NotWalletOwner();
        if (_config(wallet, permissionId).length != 32) revert PasskeyRequired();
        _record(wallet, permissionId, requestKey(wallet, permissionId, target, value, data), validUntil);
    }

    /// @notice Records an approval signed by the permission's passkey (WebAuthn assertion over `challenge(...)`).
    /// Anyone can submit it: the signature is the authority. The authenticator must have verified the user
    /// (Touch ID, PIN) and the assertion must come from the configured relying party (rpIdHash).
    function approveWithPasskey(
        address wallet,
        uint256 permissionId,
        address target,
        uint256 value,
        bytes calldata data,
        uint64 validUntil,
        WebAuthn.WebAuthnAuth calldata auth
    ) external {
        bytes memory config = _config(wallet, permissionId);
        if (config.length != 128 && config.length != 160) revert NoPasskey();
        (, bytes32 x, bytes32 y, bytes32 rpIdHash) = abi.decode(config, (uint256, bytes32, bytes32, bytes32));

        if (auth.authenticatorData.length < 37 || bytes32(auth.authenticatorData[0:32]) != rpIdHash) {
            revert InvalidPasskeySignature();
        }
        bytes32 expected = challenge(wallet, permissionId, target, value, data, validUntil);
        if (!WebAuthn.verify(abi.encode(expected), true, auth, x, y)) revert InvalidPasskeySignature();

        bytes32 key = requestKey(wallet, permissionId, target, value, data);
        nonces[key] += 1;
        _record(wallet, permissionId, key, validUntil);
    }

    function _record(address wallet, uint256 permissionId, bytes32 key, uint64 validUntil) internal {
        if (validUntil < block.timestamp || validUntil > block.timestamp + MAX_APPROVAL_TTL) revert InvalidExpiry();
        approvedUntil[key] = validUntil;
        emit Approved(wallet, permissionId, key, validUntil);
    }

    function beforeExecute(
        uint256 permissionId,
        address,
        address target,
        uint256 value,
        bytes calldata data,
        bytes calldata config
    ) external {
        if (!_needsApproval(msg.sender, permissionId, target, value, config)) return;

        bytes32 key = requestKey(msg.sender, permissionId, target, value, data);
        if (approvedUntil[key] < block.timestamp) revert ApprovalRequired(key);
        delete approvedUntil[key];
        emit ApprovalUsed(msg.sender, permissionId, key);
        // Only an approved purchase makes a payee known; nothing else adds to the set.
        if (!knownPayee[msg.sender][permissionId][target]) {
            knownPayee[msg.sender][permissionId][target] = true;
            emit PayeeKnown(msg.sender, permissionId, target);
        }
    }

    function _needsApproval(address wallet, uint256 permissionId, address target, uint256 value, bytes memory config)
        internal
        view
        returns (bool)
    {
        if (value > abi.decode(config, (uint256))) return true;
        if (config.length != 160) return false;
        (,,,, uint256 flags) = abi.decode(config, (uint256, bytes32, bytes32, bytes32, uint256));
        return flags & UNKNOWN_PAYEES_NEED_APPROVAL != 0 && !knownPayee[wallet][permissionId][target];
    }

    function _config(address wallet, uint256 permissionId) internal view returns (bytes memory) {
        ReusablePermissionWallet.Hook[] memory hooks = ReusablePermissionWallet(payable(wallet)).hooksOf(permissionId);
        for (uint256 i = 0; i < hooks.length; i++) {
            if (hooks[i].hook == address(this)) return hooks[i].config;
        }
        revert NotAttached();
    }
}
