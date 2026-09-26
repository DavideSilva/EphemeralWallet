// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice A plugin attached to a ReusablePermissionWallet permission when the permission is created.
/// The wallet calls it before every purchase made with that permission; reverting holds the purchase.
/// `msg.sender` is the wallet, so a hook keys any state it keeps by (msg.sender, permissionId). Anyone can
/// call a hook directly, which is harmless for the same reason. Hooks must not call back into the wallet.
interface IPermissionHook {
    /// @dev Runs after the permission's built-in checks, before the call to the merchant.
    function beforeExecute(
        uint256 permissionId,
        address agent,
        address target,
        uint256 value,
        bytes calldata data,
        bytes calldata config
    ) external;
}
