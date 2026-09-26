// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {ReusablePermissionWallet} from "../src/ReusablePermissionWallet.sol";
import {ApprovalHook} from "../src/ApprovalHook.sol";
import {Merchant} from "../src/Merchant.sol";
import {Base64} from "solady/utils/Base64.sol";
import {LibString} from "solady/utils/LibString.sol";
import {P256} from "solady/utils/P256.sol";
import {WebAuthn} from "solady/utils/WebAuthn.sol";

contract ApprovalHookPasskeyTest is Test {
    address owner = makeAddr("owner");
    address agent = makeAddr("agent");
    address relayer = makeAddr("relayer");

    uint256 passkey = uint256(keccak256("owner passkey")) % P256.N;
    bytes32 x;
    bytes32 y;
    bytes32 rpIdHash = sha256("localhost");

    ReusablePermissionWallet wallet;
    ApprovalHook hook;
    Merchant shop;
    uint256 card;

    uint256 constant THRESHOLD = 0.005 ether;
    uint256 constant FIVE = 0.025 ether;

    function setUp() public {
        (uint256 px, uint256 py) = vm.publicKeyP256(passkey);
        (x, y) = (bytes32(px), bytes32(py));

        wallet = new ReusablePermissionWallet{value: 5 ether}(owner);
        hook = new ApprovalHook();

        Merchant.Item[] memory items = new Merchant.Item[](1);
        items[0] = Merchant.Item("Concert ticket", 0.005 ether);
        shop = new Merchant("Ticket office", items);

        ReusablePermissionWallet.Hook[] memory hooks = new ReusablePermissionWallet.Hook[](1);
        hooks[0] = ReusablePermissionWallet.Hook(address(hook), abi.encode(THRESHOLD, x, y, rpIdHash));
        vm.prank(owner);
        card = wallet.createPermissionWithHooks(
            agent, address(shop), 1 ether, uint64(block.timestamp + 1 days), 10, address(0), hooks
        );
    }

    function buy(uint256 quantity) internal pure returns (bytes memory) {
        return abi.encodeCall(Merchant.buy, (0, quantity));
    }

    function until() internal view returns (uint64) {
        return uint64(block.timestamp + 1 hours);
    }

    /// @dev Builds a WebAuthn assertion the way a browser would, signed by `key` over `challengeBytes`.
    function assertion(uint256 key, bytes32 challengeBytes, bytes32 rpHash, bytes1 flags)
        internal
        returns (WebAuthn.WebAuthnAuth memory auth)
    {
        auth.authenticatorData = abi.encodePacked(rpHash, flags, uint32(1));
        auth.clientDataJSON = string.concat(
            '{"type":"webauthn.get","challenge":"',
            Base64.encode(abi.encode(challengeBytes), true, true),
            '","origin":"http://localhost:5173","crossOrigin":false}'
        );
        auth.typeIndex = 1;
        auth.challengeIndex = 23;
        bytes32 digest = sha256(abi.encodePacked(auth.authenticatorData, sha256(bytes(auth.clientDataJSON))));
        (bytes32 r, bytes32 s) = vm.signP256(key, digest);
        auth.r = r;
        auth.s = P256.normalized(s);
    }

    function signedApproval(uint256 quantity) internal returns (WebAuthn.WebAuthnAuth memory) {
        bytes32 c = hook.challenge(address(wallet), card, address(shop), quantity * 0.005 ether, buy(quantity), until());
        return assertion(passkey, c, rpIdHash, 0x05);
    }

    function approveWithPasskey(uint256 quantity, WebAuthn.WebAuthnAuth memory auth) internal {
        vm.prank(relayer);
        hook.approveWithPasskey(address(wallet), card, address(shop), quantity * 0.005 ether, buy(quantity), until(), auth);
    }

    function testChallengeIndexMatchesTheJson() public pure {
        assertEq(LibString.indexOf('{"type":"webauthn.get","challenge":"', '"challenge"'), 23);
    }

    function testPasskeyApprovalLetsThePurchaseThrough() public {
        approveWithPasskey(5, signedApproval(5));
        vm.prank(agent);
        wallet.execute(card, address(shop), FIVE, buy(5), "five tickets");
        (, , , uint256 spent, , , , , ) = wallet.permissions(card);
        assertEq(spent, FIVE);
    }

    function testOwnerAccountCannotApproveAPasskeyCard() public {
        vm.expectRevert(ApprovalHook.PasskeyRequired.selector);
        vm.prank(owner);
        hook.approve(address(wallet), card, address(shop), FIVE, buy(5), until());
    }

    function testSignatureCannotBeReplayed() public {
        WebAuthn.WebAuthnAuth memory auth = signedApproval(5);
        approveWithPasskey(5, auth);
        vm.prank(agent);
        wallet.execute(card, address(shop), FIVE, buy(5), "");

        vm.expectRevert(ApprovalHook.InvalidPasskeySignature.selector);
        approveWithPasskey(5, auth);
    }

    function testSignatureForOnePurchaseDoesNotApproveAnother() public {
        WebAuthn.WebAuthnAuth memory auth = signedApproval(5);
        vm.expectRevert(ApprovalHook.InvalidPasskeySignature.selector);
        approveWithPasskey(6, auth);
    }

    function testWrongKeyFails() public {
        bytes32 c = hook.challenge(address(wallet), card, address(shop), FIVE, buy(5), until());
        WebAuthn.WebAuthnAuth memory auth = assertion(uint256(keccak256("someone else")) % P256.N, c, rpIdHash, 0x05);
        vm.expectRevert(ApprovalHook.InvalidPasskeySignature.selector);
        approveWithPasskey(5, auth);
    }

    function testUserVerificationIsRequired() public {
        bytes32 c = hook.challenge(address(wallet), card, address(shop), FIVE, buy(5), until());
        WebAuthn.WebAuthnAuth memory auth = assertion(passkey, c, rpIdHash, 0x01); // user present, not verified
        vm.expectRevert(ApprovalHook.InvalidPasskeySignature.selector);
        approveWithPasskey(5, auth);
    }

    function testWrongRelyingPartyFails() public {
        bytes32 c = hook.challenge(address(wallet), card, address(shop), FIVE, buy(5), until());
        WebAuthn.WebAuthnAuth memory auth = assertion(passkey, c, sha256("evil.example"), 0x05);
        vm.expectRevert(ApprovalHook.InvalidPasskeySignature.selector);
        approveWithPasskey(5, auth);
    }

    function testExpiryIsPartOfTheSignature() public {
        WebAuthn.WebAuthnAuth memory auth = signedApproval(5);
        vm.expectRevert(ApprovalHook.InvalidPasskeySignature.selector);
        vm.prank(relayer);
        hook.approveWithPasskey(address(wallet), card, address(shop), FIVE, buy(5), until() + 1, auth);
    }

    function testPasskeyApprovalOnAnOwnerCardIsRejected() public {
        ReusablePermissionWallet.Hook[] memory hooks = new ReusablePermissionWallet.Hook[](1);
        hooks[0] = ReusablePermissionWallet.Hook(address(hook), abi.encode(THRESHOLD));
        vm.prank(owner);
        uint256 plain = wallet.createPermissionWithHooks(
            agent, address(shop), 1 ether, uint64(block.timestamp + 1 days), 10, address(0), hooks
        );
        WebAuthn.WebAuthnAuth memory auth = signedApproval(5);
        vm.expectRevert(ApprovalHook.NoPasskey.selector);
        vm.prank(relayer);
        hook.approveWithPasskey(address(wallet), plain, address(shop), FIVE, buy(5), until(), auth);
    }

    function testUnderThresholdNeedsNoPasskey() public {
        vm.prank(agent);
        wallet.execute(card, address(shop), 0.005 ether, buy(1), "");
    }
}
