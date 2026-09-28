// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {ReusablePermissionWallet} from "../src/ReusablePermissionWallet.sol";
import {ApprovalHook} from "../src/ApprovalHook.sol";
import {IPermissionHook} from "../src/IPermissionHook.sol";
import {MockEIP3009} from "./mocks/MockEIP3009.sol";
import {Base64} from "solady/utils/Base64.sol";
import {P256} from "solady/utils/P256.sol";
import {WebAuthn} from "solady/utils/WebAuthn.sol";

/// @dev A plugin that tries to approve another payment from inside one.
contract ReenteringHook is IPermissionHook {
    function beforeExecute(uint256 permissionId, address, address target, uint256 value, bytes calldata, bytes calldata)
        external
    {
        ReusablePermissionWallet(payable(msg.sender)).approvePayment(
            permissionId, target, value, 0, block.timestamp + 5 minutes, keccak256("again")
        );
    }
}

/// x402 payments (approvePayment) with the approval plugin in passkey mode and the unknown-payee rule.
contract PaymentApprovalTest is Test {
    address owner = makeAddr("owner");
    address agent = makeAddr("agent");
    address payee = makeAddr("payee");
    address thief = makeAddr("thief");
    address relayer = makeAddr("relayer");

    uint256 passkey = uint256(keccak256("owner passkey")) % P256.N;
    bytes32 x;
    bytes32 y;
    bytes32 rpIdHash = sha256("localhost");

    MockEIP3009 usdc;
    ReusablePermissionWallet wallet;
    ApprovalHook hook;
    uint256 card;

    uint256 constant THRESHOLD = 250_000; // 0.25 USDC
    uint256 nonceSeed;

    function setUp() public {
        (uint256 px, uint256 py) = vm.publicKeyP256(passkey);
        (x, y) = (bytes32(px), bytes32(py));
        usdc = new MockEIP3009();
        hook = new ApprovalHook();
        wallet = new ReusablePermissionWallet(owner);
        usdc.mint(address(wallet), 1_000_000);
        card = issue(abi.encode(THRESHOLD, x, y, rpIdHash, hook.UNKNOWN_PAYEES_NEED_APPROVAL()));
    }

    function issue(bytes memory config) internal returns (uint256) {
        ReusablePermissionWallet.Hook[] memory hooks = new ReusablePermissionWallet.Hook[](1);
        hooks[0] = ReusablePermissionWallet.Hook(address(hook), config);
        vm.prank(owner);
        return wallet.createPermissionWithHooks(
            agent, address(0), 1_000_000, uint64(block.timestamp + 1 days), 20, address(usdc), hooks
        );
    }

    function pay(uint256 id, address to, uint256 amount) internal returns (bytes32 nonce) {
        nonce = keccak256(abi.encode("nonce", ++nonceSeed));
        vm.prank(agent);
        wallet.approvePayment(id, to, amount, 0, block.timestamp + 5 minutes, nonce);
    }

    function held(uint256 id, address to, uint256 amount) internal view returns (bytes memory) {
        return abi.encodeWithSelector(
            ReusablePermissionWallet.HookRejected.selector,
            address(hook),
            abi.encodeWithSelector(ApprovalHook.ApprovalRequired.selector, hook.requestKey(address(wallet), id, to, amount, ""))
        );
    }

    function expectHeld(uint256 id, address to, uint256 amount) internal {
        vm.expectRevert(held(id, to, amount));
        vm.prank(agent);
        wallet.approvePayment(id, to, amount, 0, block.timestamp + 5 minutes, keccak256(abi.encode("held", ++nonceSeed)));
    }

    /// @dev The owner approves "pay `to` this `amount`" with a WebAuthn assertion, relayed by anyone.
    function approveWithTouchId(uint256 id, address to, uint256 amount) internal {
        uint64 until = uint64(block.timestamp + 1 hours);
        bytes32 c = hook.challenge(address(wallet), id, to, amount, "", until);
        WebAuthn.WebAuthnAuth memory auth;
        auth.authenticatorData = abi.encodePacked(rpIdHash, bytes1(0x05), uint32(1));
        auth.clientDataJSON = string.concat(
            '{"type":"webauthn.get","challenge":"', Base64.encode(abi.encode(c), true, true), '","origin":"http://localhost:5173"}'
        );
        auth.typeIndex = 1;
        auth.challengeIndex = 23;
        (bytes32 r, bytes32 s) =
            vm.signP256(passkey, sha256(abi.encodePacked(auth.authenticatorData, sha256(bytes(auth.clientDataJSON)))));
        auth.r = r;
        auth.s = P256.normalized(s);
        vm.prank(relayer);
        hook.approveWithPasskey(address(wallet), id, to, amount, "", until, auth);
    }

    function spent(uint256 id) internal view returns (uint256 amount, uint32 uses) {
        (, , , amount, , , uses, , ) = wallet.permissions(id);
    }

    function testUnknownPayeeIsHeldAtAnyAmountAndNothingIsConsumed() public {
        assertTrue(hook.needsApproval(address(wallet), card, payee, 10_000));
        expectHeld(card, payee, 10_000);
        (uint256 amount, uint32 uses) = spent(card);
        assertEq(amount, 0);
        assertEq(uses, 0);
    }

    function testTouchIdApprovalLetsTheFirstPaymentThroughAndSettles() public {
        approveWithTouchId(card, payee, 10_000);
        bytes32 nonce = pay(card, payee, 10_000);

        assertTrue(hook.knownPayee(address(wallet), card, payee));
        assertEq(wallet.approvedNonce(nonce), card + 1);
        // The authorization settles on the token through ERC-1271.
        usdc.transferWithAuthorization(address(wallet), payee, 10_000, 0, block.timestamp + 5 minutes, nonce, new bytes(96));
        assertEq(usdc.balanceOf(payee), 10_000);
    }

    function testKnownPayeeUnderThresholdPaysWithoutTouchId() public {
        approveWithTouchId(card, payee, 10_000);
        pay(card, payee, 10_000);

        assertFalse(hook.needsApproval(address(wallet), card, payee, 20_000));
        pay(card, payee, 20_000);
        (uint256 amount, uint32 uses) = spent(card);
        assertEq(amount, 30_000);
        assertEq(uses, 2);
    }

    function testKnownPayeeOverThresholdStillNeedsTouchId() public {
        approveWithTouchId(card, payee, 10_000);
        pay(card, payee, 10_000);

        expectHeld(card, payee, 300_000);
        approveWithTouchId(card, payee, 300_000);
        pay(card, payee, 300_000);
    }

    function testHackedAgentCannotSplitTheBudgetToItself() public {
        for (uint256 amount = 1; amount <= THRESHOLD; amount = amount * 50 + 1) {
            expectHeld(card, thief, amount);
        }
        (uint256 amount, ) = spent(card);
        assertEq(amount, 0);
    }

    function testApprovalIsSingleUse() public {
        approveWithTouchId(card, payee, 300_000);
        pay(card, payee, 300_000);
        expectHeld(card, payee, 300_000);
    }

    function testApprovalCoversOnlyThatPayeeAndAmount() public {
        approveWithTouchId(card, payee, 10_000);
        expectHeld(card, payee, 10_001);
        expectHeld(card, thief, 10_000);
    }

    function testOnlyAnApprovedPaymentMakesAPayeeKnown() public {
        // A held attempt, a rejected attempt, and an approval that isn't used don't make the payee known.
        expectHeld(card, payee, 10_000);
        approveWithTouchId(card, payee, 10_000);
        assertFalse(hook.knownPayee(address(wallet), card, payee));
        pay(card, payee, 10_000);
        assertTrue(hook.knownPayee(address(wallet), card, payee));
    }

    function testKnownPayeesArePerPermission() public {
        approveWithTouchId(card, payee, 10_000);
        pay(card, payee, 10_000);
        uint256 other = issue(abi.encode(THRESHOLD, x, y, rpIdHash, hook.UNKNOWN_PAYEES_NEED_APPROVAL()));
        expectHeld(other, payee, 10_000);
    }

    function testWithoutTheFlagOnlyTheAmountIsChecked() public {
        uint256 amountOnly = issue(abi.encode(THRESHOLD, x, y, rpIdHash));
        pay(amountOnly, thief, 10_000);
        expectHeld(amountOnly, payee, 300_000);
    }

    function testOwnerAccountApprovesAnOwnerModePaymentCard() public {
        uint256 ownerCard = issue(abi.encode(THRESHOLD));
        expectHeld(ownerCard, payee, 300_000);
        vm.prank(owner);
        hook.approve(address(wallet), ownerCard, payee, 300_000, "", uint64(block.timestamp + 1 hours));
        pay(ownerCard, payee, 300_000);
    }

    function testOwnerAccountCannotApproveAPasskeyPaymentCard() public {
        vm.expectRevert(ApprovalHook.PasskeyRequired.selector);
        vm.prank(owner);
        hook.approve(address(wallet), card, payee, 10_000, "", uint64(block.timestamp + 1 hours));
    }

    function testPluginCannotReenterApprovePayment() public {
        ReenteringHook reentering = new ReenteringHook();
        ReusablePermissionWallet.Hook[] memory hooks = new ReusablePermissionWallet.Hook[](1);
        hooks[0] = ReusablePermissionWallet.Hook(address(reentering), "");
        vm.prank(owner);
        uint256 id = wallet.createPermissionWithHooks(
            agent, address(0), 1_000_000, uint64(block.timestamp + 1 days), 20, address(usdc), hooks
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                ReusablePermissionWallet.HookRejected.selector,
                address(reentering),
                abi.encodeWithSelector(ReusablePermissionWallet.Reentered.selector)
            )
        );
        vm.prank(agent);
        wallet.approvePayment(id, payee, 10_000, 0, block.timestamp + 5 minutes, keccak256("first"));
    }
}
