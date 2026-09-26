// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {MissionFactory} from "../src/MissionFactory.sol";
import {ReusableWalletFactory} from "../src/ReusableWalletFactory.sol";
import {Merchant} from "../src/Merchant.sol";

contract Deploy is Script {
    function run() external {
        vm.startBroadcast();
        MissionFactory missionFactory = new MissionFactory();
        ReusableWalletFactory reusableFactory = new ReusableWalletFactory();

        Merchant.Item[] memory cafeItems = new Merchant.Item[](3);
        cafeItems[0] = Merchant.Item("Espresso", 0.001 ether);
        cafeItems[1] = Merchant.Item("Flat white", 0.0015 ether);
        cafeItems[2] = Merchant.Item("Croissant", 0.002 ether);
        Merchant cafe = new Merchant(unicode"Café", cafeItems);

        Merchant.Item[] memory ticketItems = new Merchant.Item[](3);
        ticketItems[0] = Merchant.Item("Metro pass", 0.001 ether);
        ticketItems[1] = Merchant.Item("Cinema ticket", 0.002 ether);
        ticketItems[2] = Merchant.Item("Concert ticket", 0.005 ether);
        Merchant ticketOffice = new Merchant("Ticket office", ticketItems);

        Merchant.Item[] memory tipItems = new Merchant.Item[](3);
        tipItems[0] = Merchant.Item("Small tip", 0.0005 ether);
        tipItems[1] = Merchant.Item("Regular tip", 0.001 ether);
        tipItems[2] = Merchant.Item("Generous tip", 0.003 ether);
        Merchant tipJar = new Merchant("Tip jar", tipItems);
        vm.stopBroadcast();

        console2.log("MissionFactory", address(missionFactory));
        console2.log("ReusableWalletFactory", address(reusableFactory));
        console2.log("Cafe", address(cafe));
        console2.log("TicketOffice", address(ticketOffice));
        console2.log("TipJar", address(tipJar));
    }
}
