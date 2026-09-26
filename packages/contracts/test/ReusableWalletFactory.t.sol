// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {ReusableWalletFactory} from "../src/ReusableWalletFactory.sol";
import {ReusablePermissionWallet} from "../src/ReusablePermissionWallet.sol";

contract ReusableWalletFactoryTest is Test {
    ReusableWalletFactory factory;
    address owner = makeAddr("owner");

    function setUp() public {
        factory = new ReusableWalletFactory();
        vm.deal(owner, 2 ether);
    }

    function testCreatesFundedWalletOwnedByCaller() public {
        vm.prank(owner);
        address walletAddress = factory.createWallet{value: 1 ether}();

        ReusablePermissionWallet wallet = ReusablePermissionWallet(payable(walletAddress));
        assertEq(wallet.owner(), owner);
        assertEq(address(wallet).balance, 1 ether);
    }
}
