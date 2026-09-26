// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {ReusablePermissionWallet} from "../src/ReusablePermissionWallet.sol";

contract PermissionTarget {
    uint256 public calls;
    uint256 public received;

    function ping() external payable {
        calls++;
        received += msg.value;
    }
}

contract ReusablePermissionWalletTest is Test {
    address owner = makeAddr("owner");
    address agentA = makeAddr("agentA");
    address agentB = makeAddr("agentB");
    address stranger = makeAddr("stranger");

    PermissionTarget targetA;
    PermissionTarget targetB;
    ReusablePermissionWallet wallet;

    function setUp() public {
        targetA = new PermissionTarget();
        targetB = new PermissionTarget();
        wallet = new ReusablePermissionWallet{value: 5 ether}(owner);
    }

    function createPermission(address agent, address target, uint256 budget, uint32 uses)
        internal
        returns (uint256)
    {
        vm.prank(owner);
        return wallet.createPermission(
            agent,
            target,
            budget,
            uint64(block.timestamp + 1 hours),
            uses
        );
    }

    function testMultiplePermissionsCanCoexist() public {
        uint256 permissionA = createPermission(agentA, address(targetA), 1 ether, 2);
        uint256 permissionB = createPermission(agentB, address(targetB), 2 ether, 1);

        vm.prank(agentA);
        wallet.execute(permissionA, address(targetA), 0.4 ether, abi.encodeCall(PermissionTarget.ping, ()));

        vm.prank(agentB);
        wallet.execute(permissionB, address(targetB), 1.5 ether, abi.encodeCall(PermissionTarget.ping, ()));

        (, , , uint256 spentA, , , uint32 usesA, ) = wallet.permissions(permissionA);
        (, , , uint256 spentB, , , uint32 usesB, ) = wallet.permissions(permissionB);

        assertEq(spentA, 0.4 ether);
        assertEq(usesA, 1);
        assertEq(spentB, 1.5 ether);
        assertEq(usesB, 1);
        assertEq(address(wallet).balance, 3.1 ether);
    }

    function testPermissionTracksCumulativeSpend() public {
        uint256 permissionId = createPermission(agentA, address(targetA), 1 ether, 3);

        vm.prank(agentA);
        wallet.execute(permissionId, address(targetA), 0.6 ether, abi.encodeCall(PermissionTarget.ping, ()));

        vm.expectRevert(ReusablePermissionWallet.SpendLimitExceeded.selector);
        vm.prank(agentA);
        wallet.execute(permissionId, address(targetA), 0.5 ether, abi.encodeCall(PermissionTarget.ping, ()));
    }

    function testPermissionStopsAtMaxUses() public {
        uint256 permissionId = createPermission(agentA, address(targetA), 1 ether, 2);

        vm.prank(agentA);
        wallet.execute(permissionId, address(targetA), 0.1 ether, abi.encodeCall(PermissionTarget.ping, ()));
        vm.prank(agentA);
        wallet.execute(permissionId, address(targetA), 0.1 ether, abi.encodeCall(PermissionTarget.ping, ()));

        vm.expectRevert(ReusablePermissionWallet.PermissionExhausted.selector);
        vm.prank(agentA);
        wallet.execute(permissionId, address(targetA), 0.1 ether, abi.encodeCall(PermissionTarget.ping, ()));
    }

    function testOwnerCanRevokeOnePermissionWithoutAffectingAnother() public {
        uint256 permissionA = createPermission(agentA, address(targetA), 1 ether, 2);
        uint256 permissionB = createPermission(agentB, address(targetB), 1 ether, 2);

        vm.prank(owner);
        wallet.revokePermission(permissionA);

        vm.expectRevert(ReusablePermissionWallet.PermissionIsRevoked.selector);
        vm.prank(agentA);
        wallet.execute(permissionA, address(targetA), 0.1 ether, abi.encodeCall(PermissionTarget.ping, ()));

        vm.prank(agentB);
        wallet.execute(permissionB, address(targetB), 0.1 ether, abi.encodeCall(PermissionTarget.ping, ()));
        assertEq(targetB.calls(), 1);
    }

    function testPermissionCannotCallAnotherTarget() public {
        uint256 permissionId = createPermission(agentA, address(targetA), 1 ether, 1);

        vm.expectRevert(ReusablePermissionWallet.InvalidTarget.selector);
        vm.prank(agentA);
        wallet.execute(permissionId, address(targetB), 0.1 ether, abi.encodeCall(PermissionTarget.ping, ()));
    }

    function testOtherAgentCannotUsePermission() public {
        uint256 permissionId = createPermission(agentA, address(targetA), 1 ether, 1);

        vm.expectRevert(ReusablePermissionWallet.NotAgent.selector);
        vm.prank(agentB);
        wallet.execute(permissionId, address(targetA), 0.1 ether, abi.encodeCall(PermissionTarget.ping, ()));
    }

    function testExpiredPermissionCannotExecute() public {
        uint256 permissionId = createPermission(agentA, address(targetA), 1 ether, 1);
        vm.warp(block.timestamp + 2 hours);

        vm.expectRevert(ReusablePermissionWallet.PermissionExpired.selector);
        vm.prank(agentA);
        wallet.execute(permissionId, address(targetA), 0.1 ether, abi.encodeCall(PermissionTarget.ping, ()));
    }

    function testOwnerCanWithdrawWithoutDestroyingWallet() public {
        uint256 beforeBalance = owner.balance;

        vm.prank(owner);
        wallet.withdraw(2 ether);

        assertEq(owner.balance - beforeBalance, 2 ether);
        assertEq(address(wallet).balance, 3 ether);

        uint256 permissionId = createPermission(agentA, address(targetA), 1 ether, 1);
        vm.prank(agentA);
        wallet.execute(permissionId, address(targetA), 0.1 ether, abi.encodeCall(PermissionTarget.ping, ()));
        assertEq(targetA.calls(), 1);
    }
}
