// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {MissionFactory} from "../src/MissionFactory.sol";
import {DemoShop} from "../src/DemoShop.sol";

contract Deploy is Script {
    function run() external returns (MissionFactory factory, DemoShop shop) {
        vm.startBroadcast();
        factory = new MissionFactory();
        shop = new DemoShop();
        vm.stopBroadcast();

        console2.log("MissionFactory", address(factory));
        console2.log("DemoShop", address(shop));
    }
}
