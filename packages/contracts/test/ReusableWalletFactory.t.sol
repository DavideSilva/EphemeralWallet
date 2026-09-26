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

    function testCreateWalletForSetsOwnerAndFirstTokenPermission() public {
        address agent = makeAddr("agent");
        address token = makeAddr("usdc");
        address creator = makeAddr("creator");

        vm.expectEmit(true, false, true, false, address(factory));
        emit ReusableWalletFactory.WalletCreatedFor(owner, address(0), creator);
        vm.prank(creator);
        address walletAddress = factory.createWalletFor(owner, agent, token, 1e6, uint64(block.timestamp + 1 days), 10);

        ReusablePermissionWallet wallet = ReusablePermissionWallet(payable(walletAddress));
        assertEq(wallet.owner(), owner);
        assertEq(factory.lastWallet(creator), walletAddress);
        (address pAgent, address pTarget, uint256 maxSpend, , , uint32 maxUses, , , address asset) = wallet.permissions(0);
        assertEq(pAgent, agent);
        assertEq(pTarget, address(0));
        assertEq(maxSpend, 1e6);
        assertEq(maxUses, 10);
        assertEq(asset, token);
    }
}
