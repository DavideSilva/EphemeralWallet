// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {ReusablePermissionWallet} from "../src/ReusablePermissionWallet.sol";
import {IPermissionHook} from "../src/IPermissionHook.sol";

contract HookTarget {
    uint256 public calls;

    function ping() external payable {
        calls++;
    }
}

/// @dev Records what the wallet passed in, and holds purchases above `limit` if one is set in its config.
contract RecordingHook is IPermissionHook {
    error TooBig(uint256 value);

    address public lastWallet;
    uint256 public lastPermissionId;
    address public lastAgent;
    address public lastTarget;
    uint256 public lastValue;
    bytes public lastData;
    bytes public lastConfig;
    uint256 public calls;

    function beforeExecute(
        uint256 permissionId,
        address agent,
        address target,
        uint256 value,
        bytes calldata data,
        bytes calldata config
    ) external {
        if (config.length == 32) {
            uint256 limit = abi.decode(config, (uint256));
            if (value > limit) revert TooBig(value);
        }
        lastWallet = msg.sender;
        lastPermissionId = permissionId;
        lastAgent = agent;
        lastTarget = target;
        lastValue = value;
        lastData = data;
        lastConfig = config;
        calls++;
    }
}

/// @dev A merchant that tries to buy again from inside the purchase.
contract ReentrantMerchant {
    ReusablePermissionWallet public wallet;
    uint256 public permissionId;

    function arm(ReusablePermissionWallet wallet_, uint256 permissionId_) external {
        wallet = wallet_;
        permissionId = permissionId_;
    }

    function buy() external payable {
        wallet.execute(permissionId, address(this), 0, abi.encodeCall(ReentrantMerchant.buy, ()), "again");
    }
}

contract PermissionHooksTest is Test {
    address owner = makeAddr("owner");
    address agent = makeAddr("agent");

    HookTarget target;
    RecordingHook hookA;
    RecordingHook hookB;
    ReusablePermissionWallet wallet;

    bytes ping = abi.encodeCall(HookTarget.ping, ());

    function setUp() public {
        target = new HookTarget();
        hookA = new RecordingHook();
        hookB = new RecordingHook();
        wallet = new ReusablePermissionWallet{value: 5 ether}(owner);
    }

    function hooks1(address hook, bytes memory config) internal pure returns (ReusablePermissionWallet.Hook[] memory list) {
        list = new ReusablePermissionWallet.Hook[](1);
        list[0] = ReusablePermissionWallet.Hook(hook, config);
    }

    function issue(address merchant, ReusablePermissionWallet.Hook[] memory hooks) internal returns (uint256) {
        vm.prank(owner);
        return wallet.createPermissionWithHooks(
            agent, merchant, 1 ether, uint64(block.timestamp + 1 hours), 5, address(0), hooks
        );
    }

    function testHookSeesThePurchaseAndItsConfig() public {
        uint256 id = issue(address(target), hooks1(address(hookA), hex"c0ffee"));

        vm.prank(agent);
        wallet.execute(id, address(target), 0.1 ether, ping, "coffee");

        assertEq(target.calls(), 1);
        assertEq(hookA.calls(), 1);
        assertEq(hookA.lastWallet(), address(wallet));
        assertEq(hookA.lastPermissionId(), id);
        assertEq(hookA.lastAgent(), agent);
        assertEq(hookA.lastTarget(), address(target));
        assertEq(hookA.lastValue(), 0.1 ether);
        assertEq(hookA.lastData(), ping);
        assertEq(hookA.lastConfig(), hex"c0ffee");
    }

    function testRejectingHookHoldsThePurchaseAndConsumesNothing() public {
        uint256 id = issue(address(target), hooks1(address(hookA), abi.encode(uint256(0.05 ether))));

        vm.expectRevert(
            abi.encodeWithSelector(
                ReusablePermissionWallet.HookRejected.selector,
                address(hookA),
                abi.encodeWithSelector(RecordingHook.TooBig.selector, 0.1 ether)
            )
        );
        vm.prank(agent);
        wallet.execute(id, address(target), 0.1 ether, ping, "");

        (, , , uint256 spent, , , uint32 uses, , ) = wallet.permissions(id);
        assertEq(spent, 0);
        assertEq(uses, 0);
        assertEq(target.calls(), 0);

        vm.prank(agent);
        wallet.execute(id, address(target), 0.05 ether, ping, "");
        assertEq(target.calls(), 1);
    }

    function testEveryHookMustAllow() public {
        ReusablePermissionWallet.Hook[] memory hooks = new ReusablePermissionWallet.Hook[](2);
        hooks[0] = ReusablePermissionWallet.Hook(address(hookA), "");
        hooks[1] = ReusablePermissionWallet.Hook(address(hookB), abi.encode(uint256(0)));
        uint256 id = issue(address(target), hooks);

        vm.expectRevert(
            abi.encodeWithSelector(
                ReusablePermissionWallet.HookRejected.selector,
                address(hookB),
                abi.encodeWithSelector(RecordingHook.TooBig.selector, 0.1 ether)
            )
        );
        vm.prank(agent);
        wallet.execute(id, address(target), 0.1 ether, ping, "");
        assertEq(hookA.calls(), 0);
    }

    function testPermissionWithoutHooksIsUnaffected() public {
        vm.prank(owner);
        uint256 id = wallet.createPermission(agent, address(target), 1 ether, uint64(block.timestamp + 1 hours), 1, address(0));

        vm.prank(agent);
        wallet.execute(id, address(target), 0.9 ether, ping, "");
        assertEq(target.calls(), 1);
        assertEq(wallet.hooksOf(id).length, 0);
    }

    function testHooksOfReturnsTheAttachedHooks() public {
        vm.expectEmit(true, true, false, true, address(wallet));
        emit ReusablePermissionWallet.HookAttached(0, address(hookA), hex"01");
        uint256 id = issue(address(target), hooks1(address(hookA), hex"01"));

        ReusablePermissionWallet.Hook[] memory attached = wallet.hooksOf(id);
        assertEq(attached.length, 1);
        assertEq(attached[0].hook, address(hookA));
        assertEq(attached[0].config, hex"01");
    }

    function testOnlyOwnerCanIssueWithHooks() public {
        vm.expectRevert(ReusablePermissionWallet.NotOwner.selector);
        vm.prank(agent);
        wallet.createPermissionWithHooks(
            agent, address(target), 1 ether, uint64(block.timestamp + 1 hours), 1, address(0), hooks1(address(hookA), "")
        );
    }

    function testRejectsHookWithoutCode() public {
        vm.expectRevert(ReusablePermissionWallet.InvalidHook.selector);
        issue(address(target), hooks1(makeAddr("eoa"), ""));
    }

    function testRejectsDuplicateHook() public {
        ReusablePermissionWallet.Hook[] memory hooks = new ReusablePermissionWallet.Hook[](2);
        hooks[0] = ReusablePermissionWallet.Hook(address(hookA), "");
        hooks[1] = ReusablePermissionWallet.Hook(address(hookA), hex"01");
        vm.expectRevert(ReusablePermissionWallet.DuplicateHook.selector);
        issue(address(target), hooks);
    }

    function testRejectsTooManyHooks() public {
        ReusablePermissionWallet.Hook[] memory hooks = new ReusablePermissionWallet.Hook[](5);
        for (uint256 i = 0; i < 5; i++) {
            hooks[i] = ReusablePermissionWallet.Hook(address(new RecordingHook()), "");
        }
        vm.expectRevert(ReusablePermissionWallet.TooManyHooks.selector);
        issue(address(target), hooks);
    }

    function testTokenPermissionsTakeHooks() public {
        vm.prank(owner);
        uint256 id = wallet.createPermissionWithHooks(
            agent, address(0), 1 ether, uint64(block.timestamp + 1 hours), 1, makeAddr("usdc"), hooks1(address(hookA), "")
        );
        assertEq(wallet.hooksOf(id).length, 1);
    }

    function testMerchantCannotReenter() public {
        ReentrantMerchant merchant = new ReentrantMerchant();
        vm.prank(owner);
        uint256 id = wallet.createPermission(agent, address(merchant), 1 ether, uint64(block.timestamp + 1 hours), 5, address(0));
        merchant.arm(wallet, id);

        vm.expectRevert(
            abi.encodeWithSelector(
                ReusablePermissionWallet.CallFailed.selector,
                abi.encodeWithSelector(ReusablePermissionWallet.Reentered.selector)
            )
        );
        vm.prank(agent);
        wallet.execute(id, address(merchant), 0, abi.encodeCall(ReentrantMerchant.buy, ()), "");
    }
}
