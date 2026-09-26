// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReusablePermissionWallet} from "./ReusablePermissionWallet.sol";

contract ReusableWalletFactory {
    mapping(address => address) public lastWallet;

    event WalletCreated(address indexed owner, address indexed wallet, uint256 fundedAmount);

    function createWallet() external payable returns (address wallet) {
        ReusablePermissionWallet reusable = new ReusablePermissionWallet{value: msg.value}(msg.sender);
        wallet = address(reusable);
        lastWallet[msg.sender] = wallet;
        emit WalletCreated(msg.sender, wallet, msg.value);
    }
}
