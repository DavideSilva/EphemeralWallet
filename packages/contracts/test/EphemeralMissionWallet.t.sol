// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {EphemeralMissionWallet} from "../src/EphemeralMissionWallet.sol";

contract Target {
    uint256 public calls;
    uint256 public lastValue;

    function ping() external payable {
        calls++;
        lastValue = msg.value;
    }
}

contract EphemeralMissionWalletTest is Test {
    address owner = makeAddr("owner");
    address agent = makeAddr("agent");
    address stranger = makeAddr("stranger");
    Target target;
    Target otherTarget;
    EphemeralMissionWallet wallet;

    function setUp() public {
        target = new Target();
        otherTarget = new Target();
        wallet = new EphemeralMissionWallet{value: 1 ether}(
            owner,
            agent,
            address(target),
            0.5 ether,
            uint64(block.timestamp + 1 hours)
        );
    }

    function testAgentCanExecuteOnce() public {
        vm.prank(agent);
        wallet.execute(address(target), 0.2 ether, abi.encodeCall(Target.ping, ()), "");

        assertTrue(wallet.used());
        assertEq(target.calls(), 1);
        assertEq(target.lastValue(), 0.2 ether);

        vm.expectRevert(EphemeralMissionWallet.MissionAlreadyUsed.selector);
        vm.prank(agent);
        wallet.execute(address(target), 0, abi.encodeCall(Target.ping, ()), "");
    }

    function testStrangerCannotExecute() public {
        vm.expectRevert(EphemeralMissionWallet.NotAgent.selector);
        vm.prank(stranger);
        wallet.execute(address(target), 0, abi.encodeCall(Target.ping, ()), "");
    }

    function testCannotExceedBudget() public {
        vm.expectRevert(EphemeralMissionWallet.SpendLimitExceeded.selector);
        vm.prank(agent);
        wallet.execute(address(target), 0.6 ether, abi.encodeCall(Target.ping, ()), "");
    }

    function testCannotCallAnotherTarget() public {
        vm.expectRevert(EphemeralMissionWallet.InvalidTarget.selector);
        vm.prank(agent);
        wallet.execute(address(otherTarget), 0, abi.encodeCall(Target.ping, ()), "");
    }

    function testCannotExecuteAfterExpiry() public {
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(EphemeralMissionWallet.MissionExpired.selector);
        vm.prank(agent);
        wallet.execute(address(target), 0, abi.encodeCall(Target.ping, ()), "");
    }

    function testOwnerCanReclaimAfterExecution() public {
        vm.prank(agent);
        wallet.execute(address(target), 0.2 ether, abi.encodeCall(Target.ping, ()), "");

        uint256 beforeBalance = owner.balance;
        vm.prank(owner);
        wallet.reclaim();

        assertEq(owner.balance - beforeBalance, 0.8 ether);
        assertEq(address(wallet).balance, 0);
    }

    function testOwnerCanReclaimAfterExpiry() public {
        vm.warp(block.timestamp + 2 hours);
        vm.prank(owner);
        wallet.reclaim();
        assertEq(address(wallet).balance, 0);
    }

    function testExecuteEmitsMemo() public {
        vm.expectEmit(true, true, false, true, address(wallet));
        emit EphemeralMissionWallet.Executed(agent, address(target), 0.2 ether, abi.encodeCall(Target.ping, ()), "buy a coffee");
        vm.prank(agent);
        wallet.execute(address(target), 0.2 ether, abi.encodeCall(Target.ping, ()), "buy a coffee");
    }

    function testOwnerCanCancelAndGetRefund() public {
        uint256 beforeBalance = owner.balance;
        vm.prank(owner);
        wallet.cancel();

        assertTrue(wallet.cancelled());
        assertEq(owner.balance - beforeBalance, 1 ether);
        assertEq(address(wallet).balance, 0);
    }

    function testCancelledMissionCannotExecute() public {
        vm.prank(owner);
        wallet.cancel();

        vm.expectRevert(EphemeralMissionWallet.MissionCancelled.selector);
        vm.prank(agent);
        wallet.execute(address(target), 0, abi.encodeCall(Target.ping, ()), "");
    }

    function testCannotCancelTwice() public {
        vm.prank(owner);
        wallet.cancel();

        vm.expectRevert(EphemeralMissionWallet.MissionCancelled.selector);
        vm.prank(owner);
        wallet.cancel();
    }

    function testCannotCancelUsedMission() public {
        vm.prank(agent);
        wallet.execute(address(target), 0.2 ether, abi.encodeCall(Target.ping, ()), "");

        vm.expectRevert(EphemeralMissionWallet.MissionAlreadyUsed.selector);
        vm.prank(owner);
        wallet.cancel();
    }

    function testStrangerCannotCancel() public {
        vm.expectRevert(EphemeralMissionWallet.NotOwner.selector);
        vm.prank(stranger);
        wallet.cancel();
    }
}
