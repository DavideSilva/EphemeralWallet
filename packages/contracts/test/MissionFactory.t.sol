// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {MissionFactory} from "../src/MissionFactory.sol";
import {EphemeralMissionWallet} from "../src/EphemeralMissionWallet.sol";
import {Merchant} from "../src/Merchant.sol";

contract MissionFactoryTest is Test {
    MissionFactory factory;
    Merchant shop;
    address owner = makeAddr("owner");
    address agent = makeAddr("agent");

    function setUp() public {
        factory = new MissionFactory();
        Merchant.Item[] memory items = new Merchant.Item[](1);
        items[0] = Merchant.Item("Coffee", 0.001 ether);
        shop = new Merchant("Cafe", items);
        vm.deal(owner, 1 ether);
    }

    function testCreatesFundedMissionAndAgentExecutes() public {
        vm.prank(owner);
        address walletAddress = factory.createMission{value: 0.01 ether}(
            agent,
            address(shop),
            0.002 ether,
            uint64(block.timestamp + 10 minutes)
        );

        EphemeralMissionWallet wallet = EphemeralMissionWallet(payable(walletAddress));
        assertEq(wallet.owner(), owner);
        assertEq(wallet.agent(), agent);
        assertEq(address(wallet).balance, 0.01 ether);

        vm.prank(agent);
        wallet.execute(
            address(shop),
            0.001 ether,
            abi.encodeCall(Merchant.buy, (0, 1)),
            "buy a coffee"
        );

        assertTrue(wallet.used());
        assertEq(address(wallet).balance, 0.009 ether);
    }

    function testRejectsBudgetAboveFunding() public {
        vm.expectRevert(bytes("budget>funding"));
        vm.prank(owner);
        factory.createMission{value: 0.001 ether}(
            agent,
            address(shop),
            0.002 ether,
            uint64(block.timestamp + 10 minutes)
        );
    }
}
