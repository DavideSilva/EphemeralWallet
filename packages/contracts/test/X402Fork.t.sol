// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {ReusableWalletFactory} from "../src/ReusableWalletFactory.sol";
import {ReusablePermissionWallet} from "../src/ReusablePermissionWallet.sol";
import {ApprovalHook} from "../src/ApprovalHook.sol";

interface IUSDC {
    function balanceOf(address) external view returns (uint256);
    function transferWithAuthorization(address, address, uint256, uint256, uint256, bytes32, bytes calldata) external;
}

/// @notice Proves the wallet pays real Base Sepolia USDC (FiatToken v2.2) through ERC-1271.
/// Skips unless BASE_SEPOLIA_RPC_URL is set.
contract X402ForkTest is Test {
    IUSDC constant USDC = IUSDC(0x036CbD53842c5426634e7929541eC2318f3dCF7e);

    function testWalletPaysRealUsdcViaApprovedAuthorization() public {
        string memory rpc = vm.envOr("BASE_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);

        address agent = makeAddr("agent");
        address payTo = makeAddr("freshPayee");
        ReusableWalletFactory factory = new ReusableWalletFactory();
        ReusablePermissionWallet wallet = ReusablePermissionWallet(
            payable(factory.createWalletFor(address(this), agent, address(USDC), 1e6, uint64(block.timestamp + 1 days), 5))
        );
        deal(address(USDC), address(wallet), 5e6);

        uint256 validAfter = block.timestamp - 600;
        uint256 validBefore = block.timestamp + 300;
        bytes32 nonce = keccak256("fork-nonce");
        bytes memory sig = abi.encode(uint256(0), nonce, bytes32(0));

        vm.expectRevert();
        USDC.transferWithAuthorization(address(wallet), payTo, 0.01e6, validAfter, validBefore, nonce, sig);

        vm.prank(agent);
        wallet.approvePayment(0, payTo, 0.01e6, validAfter, validBefore, nonce);

        vm.prank(makeAddr("facilitator"));
        USDC.transferWithAuthorization(address(wallet), payTo, 0.01e6, validAfter, validBefore, nonce, sig);
        assertEq(USDC.balanceOf(payTo), 0.01e6);
    }

    /// @notice The same real-USDC payment with the approval plugin attached (owner-account mode): held until approved,
    /// then paid. Proves plugins in approvePayment work against FiatToken v2.2 and the fork's P-256 precompile.
    function testPluginHoldsThenPaysRealUsdc() public {
        string memory rpc = vm.envOr("BASE_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);

        address agent = makeAddr("agent");
        address payTo = makeAddr("freshPayee");
        ApprovalHook hook = new ApprovalHook();
        ReusablePermissionWallet wallet = new ReusablePermissionWallet(address(this));
        ReusablePermissionWallet.Hook[] memory hooks = new ReusablePermissionWallet.Hook[](1);
        hooks[0] = ReusablePermissionWallet.Hook(address(hook), abi.encode(uint256(250_000)));
        uint256 id = wallet.createPermissionWithHooks(agent, address(0), 1e6, uint64(block.timestamp + 1 days), 5, address(USDC), hooks);
        deal(address(USDC), address(wallet), 5e6);

        uint256 validAfter = block.timestamp - 600;
        uint256 validBefore = block.timestamp + 300;
        bytes32 nonce = keccak256("fork-plugin-nonce");

        vm.expectRevert();
        vm.prank(agent);
        wallet.approvePayment(id, payTo, 0.3e6, validAfter, validBefore, nonce);

        hook.approve(address(wallet), id, payTo, 0.3e6, "", uint64(block.timestamp + 1 hours));
        vm.prank(agent);
        wallet.approvePayment(id, payTo, 0.3e6, validAfter, validBefore, nonce);

        vm.prank(makeAddr("facilitator"));
        USDC.transferWithAuthorization(address(wallet), payTo, 0.3e6, validAfter, validBefore, nonce, abi.encode(id, nonce, bytes32(0)));
        assertEq(USDC.balanceOf(payTo), 0.3e6);
    }
}
