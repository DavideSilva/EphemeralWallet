// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {MissionFactory} from "../src/MissionFactory.sol";
import {ReusableWalletFactory} from "../src/ReusableWalletFactory.sol";
import {Merchant} from "../src/Merchant.sol";
import {ApprovalHook} from "../src/ApprovalHook.sol";

contract Deploy is Script {
    function run() external {
        vm.startBroadcast();
        MissionFactory missionFactory = new MissionFactory();
        ReusableWalletFactory reusableFactory = new ReusableWalletFactory();
        ApprovalHook approvalHook = new ApprovalHook();

        Merchant.Item[] memory teamLabItems = new Merchant.Item[](3);
        teamLabItems[0] = Merchant.Item("Adult ticket", 0.005 ether);
        teamLabItems[1] = Merchant.Item("Child ticket", 0.002 ether);
        teamLabItems[2] = Merchant.Item("Art book", 0.003 ether);
        Merchant teamLab = new Merchant("teamLab Borderless", teamLabItems);

        Merchant.Item[] memory railItems = new Merchant.Item[](3);
        railItems[0] = Merchant.Item("Tokyo Metro day pass", 0.001 ether);
        railItems[1] = Merchant.Item("Fuji Excursion ticket", 0.002 ether);
        railItems[2] = Merchant.Item("Shinkansen ticket", 0.005 ether);
        Merchant rail = new Merchant("JR ticket office", railItems);

        Merchant.Item[] memory ryokanItems = new Merchant.Item[](3);
        ryokanItems[0] = Merchant.Item("Onsen day pass", 0.0005 ether);
        ryokanItems[1] = Merchant.Item("Kaiseki dinner", 0.001 ether);
        ryokanItems[2] = Merchant.Item("Room with Fuji view", 0.003 ether);
        Merchant ryokan = new Merchant("Kawaguchiko ryokan", ryokanItems);
        vm.stopBroadcast();

        console2.log("MissionFactory", address(missionFactory));
        console2.log("ReusableWalletFactory", address(reusableFactory));
        console2.log("ApprovalHook", address(approvalHook));
        console2.log("TeamLab", address(teamLab));
        console2.log("RailOffice", address(rail));
        console2.log("Ryokan", address(ryokan));
    }
}
