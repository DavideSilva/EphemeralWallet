// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {ReusablePermissionWallet} from "../src/ReusablePermissionWallet.sol";
import {MockEIP3009} from "./mocks/MockEIP3009.sol";

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
            uses,
            address(0)
        );
    }

    function testMultiplePermissionsCanCoexist() public {
        uint256 permissionA = createPermission(agentA, address(targetA), 1 ether, 2);
        uint256 permissionB = createPermission(agentB, address(targetB), 2 ether, 1);

        vm.prank(agentA);
        wallet.execute(permissionA, address(targetA), 0.4 ether, abi.encodeCall(PermissionTarget.ping, ()));

        vm.prank(agentB);
        wallet.execute(permissionB, address(targetB), 1.5 ether, abi.encodeCall(PermissionTarget.ping, ()));

        (, , , uint256 spentA, , , uint32 usesA, , ) = wallet.permissions(permissionA);
        (, , , uint256 spentB, , , uint32 usesB, , ) = wallet.permissions(permissionB);

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

    MockEIP3009 token;
    address payee = makeAddr("payee");
    bytes32 constant TWA_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    function createTokenPermission(address pinnedPayee, uint256 budget, uint32 uses) internal returns (uint256) {
        if (address(token) == address(0)) token = new MockEIP3009();
        token.mint(address(wallet), 10e6);
        vm.prank(owner);
        return wallet.createPermission(agentA, pinnedPayee, budget, uint64(block.timestamp + 1 hours), uses, address(token));
    }

    function digestFor(address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                token.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(TWA_TYPEHASH, address(wallet), to, value, validAfter, validBefore, nonce))
            )
        );
    }

    function walletSig(uint256 permissionId, bytes32 nonce) internal pure returns (bytes memory) {
        return abi.encode(permissionId, nonce, bytes32(0));
    }

    function testApprovedPaymentSettlesThroughERC1271() public {
        uint256 id = createTokenPermission(address(0), 1e6, 3);
        uint256 validBefore = block.timestamp + 10 minutes;
        bytes32 nonce = keccak256("n1");

        vm.prank(agentA);
        bytes32 digest = wallet.approvePayment(id, payee, 0.25e6, 0, validBefore, nonce);

        assertEq(digest, digestFor(payee, 0.25e6, 0, validBefore, nonce));
        assertTrue(wallet.approvedDigest(digest));
        assertEq(wallet.approvedNonce(nonce), id + 1);
        (, , , uint256 spent, , , uint32 uses, , ) = wallet.permissions(id);
        assertEq(spent, 0.25e6);
        assertEq(uses, 1);

        vm.prank(stranger); // facilitator
        token.transferWithAuthorization(address(wallet), payee, 0.25e6, 0, validBefore, nonce, walletSig(id, nonce));
        assertEq(token.balanceOf(payee), 0.25e6);
    }

    function testUnapprovedDigestIsRejected() public {
        uint256 id = createTokenPermission(address(0), 1e6, 3);
        bytes32 nonce = keccak256("n1");
        bytes32 digest = digestFor(payee, 0.25e6, 0, block.timestamp + 10 minutes, nonce);
        assertEq(wallet.isValidSignature(digest, walletSig(id, nonce)), bytes4(0xffffffff));

        vm.expectRevert(bytes("sig"));
        token.transferWithAuthorization(address(wallet), payee, 0.25e6, 0, block.timestamp + 10 minutes, nonce, walletSig(id, nonce));
    }

    function testApprovePaymentEnforcesBudgetAndUses() public {
        uint256 id = createTokenPermission(address(0), 0.5e6, 2);
        vm.startPrank(agentA);
        wallet.approvePayment(id, payee, 0.3e6, 0, block.timestamp + 10 minutes, keccak256("a"));
        vm.expectRevert(ReusablePermissionWallet.SpendLimitExceeded.selector);
        wallet.approvePayment(id, payee, 0.3e6, 0, block.timestamp + 10 minutes, keccak256("b"));
        wallet.approvePayment(id, payee, 0.1e6, 0, block.timestamp + 10 minutes, keccak256("c"));
        vm.expectRevert(ReusablePermissionWallet.PermissionExhausted.selector);
        wallet.approvePayment(id, payee, 0.01e6, 0, block.timestamp + 10 minutes, keccak256("d"));
        vm.stopPrank();
    }

    function testApprovePaymentRejectsWrongAgentPinnedPayeeAndLongAuthorization() public {
        uint256 id = createTokenPermission(payee, 1e6, 5);

        vm.expectRevert(ReusablePermissionWallet.NotAgent.selector);
        vm.prank(agentB);
        wallet.approvePayment(id, payee, 0.1e6, 0, block.timestamp + 10 minutes, keccak256("a"));

        vm.startPrank(agentA);
        vm.expectRevert(ReusablePermissionWallet.InvalidTarget.selector);
        wallet.approvePayment(id, stranger, 0.1e6, 0, block.timestamp + 10 minutes, keccak256("b"));

        vm.expectRevert(ReusablePermissionWallet.AuthorizationOutlivesPermission.selector);
        wallet.approvePayment(id, payee, 0.1e6, 0, block.timestamp + 2 hours, keccak256("c"));

        wallet.approvePayment(id, payee, 0.1e6, 0, block.timestamp + 10 minutes, keccak256("d"));
        vm.expectRevert(ReusablePermissionWallet.NonceAlreadyApproved.selector);
        wallet.approvePayment(id, payee, 0.1e6, 0, block.timestamp + 10 minutes, keccak256("d"));
        vm.stopPrank();
    }

    function testApprovePaymentRejectsNativePermissionAndExecuteRejectsTokenPermission() public {
        uint256 nativeId = createPermission(agentA, address(targetA), 1 ether, 1);
        vm.expectRevert(ReusablePermissionWallet.NotTokenPermission.selector);
        vm.prank(agentA);
        wallet.approvePayment(nativeId, payee, 1, 0, block.timestamp + 10 minutes, keccak256("a"));

        uint256 tokenId = createTokenPermission(address(0), 1e6, 1);
        vm.expectRevert(ReusablePermissionWallet.NotNativePermission.selector);
        vm.prank(agentA);
        wallet.execute(tokenId, address(targetA), 0, abi.encodeCall(PermissionTarget.ping, ()));
    }

    function testRevokedOrExpiredTokenPermissionCannotApprove() public {
        uint256 id = createTokenPermission(address(0), 1e6, 5);
        vm.prank(owner);
        wallet.revokePermission(id);
        vm.expectRevert(ReusablePermissionWallet.PermissionIsRevoked.selector);
        vm.prank(agentA);
        wallet.approvePayment(id, payee, 0.1e6, 0, block.timestamp + 10 minutes, keccak256("a"));

        uint256 id2 = createTokenPermission(address(0), 1e6, 5);
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(ReusablePermissionWallet.PermissionExpired.selector);
        vm.prank(agentA);
        wallet.approvePayment(id2, payee, 0.1e6, 0, block.timestamp + 10 minutes, keccak256("b"));
    }

    function testOwnerCanWithdrawTokenAndTransferOwnership() public {
        createTokenPermission(address(0), 1e6, 1);
        vm.prank(owner);
        wallet.withdrawToken(address(token), 4e6);
        assertEq(token.balanceOf(owner), 4e6);

        vm.expectRevert(ReusablePermissionWallet.NotOwner.selector);
        vm.prank(stranger);
        wallet.transferOwnership(stranger);

        vm.prank(owner);
        wallet.transferOwnership(stranger);
        assertEq(wallet.owner(), stranger);
    }
}
