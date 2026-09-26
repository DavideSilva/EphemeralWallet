// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReusablePermissionWallet} from "./ReusablePermissionWallet.sol";

contract ReusableWalletFactory {
    mapping(address => address) public lastWallet;

    event WalletCreated(address indexed owner, address indexed wallet, uint256 fundedAmount);
    /// @notice Separate from WalletCreated: anyone can create a wallet for any owner, so a UI that binds
    /// wallets to their owner by event must not treat these as the owner's own.
    event WalletCreatedFor(address indexed owner, address indexed wallet, address indexed creator);

    function createWallet() external payable returns (address wallet) {
        ReusablePermissionWallet reusable = new ReusablePermissionWallet{value: msg.value}(msg.sender);
        wallet = address(reusable);
        lastWallet[msg.sender] = wallet;
        emit WalletCreated(msg.sender, wallet, msg.value);
    }

    /// @notice Creates a wallet owned by `owner` with one "any payee" token permission (id 0).
    /// The factory owns the wallet only for the duration of this call. Permissionless (the demo uses it
    /// to create a wallet for a flagged owner); only the owner's own createWallet emits WalletCreated.
    function createWalletFor(
        address owner,
        address agent,
        address asset,
        uint256 maxSpend,
        uint64 expiresAt,
        uint32 maxUses
    ) external returns (address wallet) {
        ReusablePermissionWallet reusable = new ReusablePermissionWallet(address(this));
        reusable.createPermission(agent, address(0), maxSpend, expiresAt, maxUses, asset);
        reusable.transferOwnership(owner);
        wallet = address(reusable);
        lastWallet[msg.sender] = wallet;
        emit WalletCreatedFor(owner, wallet, msg.sender);
    }
}
