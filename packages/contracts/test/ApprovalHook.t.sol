// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {ReusablePermissionWallet} from "../src/ReusablePermissionWallet.sol";
import {ApprovalHook} from "../src/ApprovalHook.sol";
import {Merchant} from "../src/Merchant.sol";

contract ApprovalHookTest is Test {
    address owner = makeAddr("owner");
    address agent = makeAddr("agent");
    address stranger = makeAddr("stranger");

    ReusablePermissionWallet wallet;
    ApprovalHook hook;
    Merchant shop;
    uint256 card;

    uint256 constant THRESHOLD = 0.005 ether;

    function setUp() public {
        wallet = new ReusablePermissionWallet{value: 5 ether}(owner);
        hook = new ApprovalHook();

        Merchant.Item[] memory items = new Merchant.Item[](1);
        items[0] = Merchant.Item("Concert ticket", 0.005 ether);
        shop = new Merchant("Ticket office", items);

        card = issue(wallet);
    }

    function issue(ReusablePermissionWallet w) internal returns (uint256) {
        ReusablePermissionWallet.Hook[] memory hooks = new ReusablePermissionWallet.Hook[](1);
        hooks[0] = ReusablePermissionWallet.Hook(address(hook), abi.encode(THRESHOLD));
        vm.prank(w.owner());
        return w.createPermissionWithHooks(
            agent, address(shop), 1 ether, uint64(block.timestamp + 1 days), 10, address(0), hooks
        );
    }

    function buy(uint256 quantity) internal pure returns (bytes memory) {
        return abi.encodeCall(Merchant.buy, (0, quantity));
    }

    function held(ReusablePermissionWallet w, uint256 id, uint256 quantity) internal view returns (bytes memory) {
        bytes32 key = hook.requestKey(address(w), id, address(shop), quantity * 0.005 ether, buy(quantity));
        return abi.encodeWithSelector(
            ReusablePermissionWallet.HookRejected.selector,
            address(hook),
            abi.encodeWithSelector(ApprovalHook.ApprovalRequired.selector, key)
        );
    }

    function approve(uint256 quantity) internal {
        vm.prank(owner);
        hook.approve(address(wallet), card, address(shop), quantity * 0.005 ether, buy(quantity), uint64(block.timestamp + 1 hours));
    }

    function testAtOrUnderThresholdNeedsNoApproval() public {
        vm.prank(agent);
        wallet.execute(card, address(shop), 0.005 ether, buy(1), "one ticket");
        (, , , uint256 spent, , , , , ) = wallet.permissions(card);
        assertEq(spent, 0.005 ether);
    }

    function testOverThresholdIsHeld() public {
        vm.expectRevert(held(wallet, card, 5));
        vm.prank(agent);
        wallet.execute(card, address(shop), 0.025 ether, buy(5), "five tickets");
    }

    function testApprovalLetsThatPurchaseThroughOnce() public {
        approve(5);

        bytes32 key = hook.requestKey(address(wallet), card, address(shop), 0.025 ether, buy(5));
        vm.expectEmit(true, true, true, true, address(hook));
        emit ApprovalHook.ApprovalUsed(address(wallet), card, key);
        vm.prank(agent);
        wallet.execute(card, address(shop), 0.025 ether, buy(5), "five tickets");
        assertEq(hook.approvedUntil(key), 0);

        vm.expectRevert(held(wallet, card, 5));
        vm.prank(agent);
        wallet.execute(card, address(shop), 0.025 ether, buy(5), "five tickets again");
    }

    function testApprovalDoesNotCoverADifferentPurchase() public {
        approve(5);
        vm.expectRevert(held(wallet, card, 6));
        vm.prank(agent);
        wallet.execute(card, address(shop), 0.03 ether, buy(6), "six tickets");
    }

    function testExpiredApprovalFails() public {
        approve(5);
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(held(wallet, card, 5));
        vm.prank(agent);
        wallet.execute(card, address(shop), 0.025 ether, buy(5), "");
    }

    function testApprovalDoesNotApplyToAnotherPermission() public {
        uint256 other = issue(wallet);
        approve(5);
        vm.expectRevert(held(wallet, other, 5));
        vm.prank(agent);
        wallet.execute(other, address(shop), 0.025 ether, buy(5), "");
    }

    function testFakeWalletCannotApproveForARealCard() public {
        ReusablePermissionWallet fake = new ReusablePermissionWallet(stranger);
        uint256 fakeCard = issue(fake);

        vm.prank(stranger);
        hook.approve(address(fake), fakeCard, address(shop), 0.025 ether, buy(5), uint64(block.timestamp + 1 hours));

        vm.expectRevert(held(wallet, card, 5));
        vm.prank(agent);
        wallet.execute(card, address(shop), 0.025 ether, buy(5), "");
    }

    function testOnlyTheWalletOwnerCanApprove() public {
        vm.expectRevert(ApprovalHook.NotWalletOwner.selector);
        vm.prank(agent);
        hook.approve(address(wallet), card, address(shop), 0.025 ether, buy(5), uint64(block.timestamp + 1 hours));
    }

    function testApproveNeedsTheHookOnThatPermission() public {
        vm.prank(owner);
        uint256 plain = wallet.createPermission(agent, address(shop), 1 ether, uint64(block.timestamp + 1 days), 1, address(0));
        vm.expectRevert(ApprovalHook.NotAttached.selector);
        vm.prank(owner);
        hook.approve(address(wallet), plain, address(shop), 0.025 ether, buy(5), uint64(block.timestamp + 1 hours));
    }

    function testApprovalExpiryMustBeWithinADay() public {
        vm.startPrank(owner);
        vm.expectRevert(ApprovalHook.InvalidExpiry.selector);
        hook.approve(address(wallet), card, address(shop), 0.025 ether, buy(5), uint64(block.timestamp + 1 days + 1));
        vm.warp(block.timestamp + 10);
        vm.expectRevert(ApprovalHook.InvalidExpiry.selector);
        hook.approve(address(wallet), card, address(shop), 0.025 ether, buy(5), uint64(block.timestamp - 1));
        vm.stopPrank();
    }

    function testThresholdOf() public view {
        assertEq(hook.thresholdOf(address(wallet), card), THRESHOLD);
    }

    function testMerchantFailureKeepsTheApproval() public {
        approve(5);
        // Wrong payment: the merchant reverts, so the whole purchase (and the approval's use) rolls back.
        bytes32 key = hook.requestKey(address(wallet), card, address(shop), 0.03 ether, buy(5));
        vm.prank(owner);
        hook.approve(address(wallet), card, address(shop), 0.03 ether, buy(5), uint64(block.timestamp + 1 hours));
        vm.expectRevert();
        vm.prank(agent);
        wallet.execute(card, address(shop), 0.03 ether, buy(5), "");
        assertGt(hook.approvedUntil(key), 0);
    }
}
