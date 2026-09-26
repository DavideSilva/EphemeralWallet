// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPermissionHook} from "./IPermissionHook.sol";
import {ReusablePermissionWallet} from "./ReusablePermissionWallet.sol";

/// @notice Plugin: purchases above a threshold need the owner's approval of that exact purchase.
/// Config per permission: `abi.encode(uint256 threshold)`, in wei. The threshold applies to each purchase on its
/// own, so a large order split into small ones is not caught (only the card's budget and uses bound it).
/// An approval covers one purchase (wallet, permission, merchant, value and calldata), once, until it expires.
contract ApprovalHook is IPermissionHook {
    error ApprovalRequired(bytes32 requestKey);
    error NotWalletOwner();
    error NotAttached();
    error InvalidExpiry();

    event Approved(address indexed wallet, uint256 indexed permissionId, bytes32 indexed requestKey, uint64 validUntil);
    event ApprovalUsed(address indexed wallet, uint256 indexed permissionId, bytes32 indexed requestKey);

    uint64 public constant MAX_APPROVAL_TTL = 1 days;

    /// @notice requestKey => last second the approval can be used (0 = none).
    mapping(bytes32 => uint64) public approvedUntil;

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
        _config(wallet, permissionId);
        if (validUntil < block.timestamp || validUntil > block.timestamp + MAX_APPROVAL_TTL) revert InvalidExpiry();

        bytes32 key = requestKey(wallet, permissionId, target, value, data);
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
        if (value <= abi.decode(config, (uint256))) return;

        bytes32 key = requestKey(msg.sender, permissionId, target, value, data);
        if (approvedUntil[key] < block.timestamp) revert ApprovalRequired(key);
        delete approvedUntil[key];
        emit ApprovalUsed(msg.sender, permissionId, key);
    }

    function _config(address wallet, uint256 permissionId) internal view returns (bytes memory) {
        ReusablePermissionWallet.Hook[] memory hooks = ReusablePermissionWallet(payable(wallet)).hooksOf(permissionId);
        for (uint256 i = 0; i < hooks.length; i++) {
            if (hooks[i].hook == address(this)) return hooks[i].config;
        }
        revert NotAttached();
    }
}
