// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {MissionFactory} from "../src/MissionFactory.sol";
import {ReusableWalletFactory} from "../src/ReusableWalletFactory.sol";
import {DemoShop} from "../src/DemoShop.sol";

contract Deploy is Script {
    function run()
        external
        returns (MissionFactory missionFactory, ReusableWalletFactory reusableFactory, DemoShop shop)
    {
        vm.startBroadcast();
        missionFactory = new MissionFactory();
        reusableFactory = new ReusableWalletFactory();
        shop = new DemoShop();
        vm.stopBroadcast();

        console2.log("MissionFactory", address(missionFactory));
        console2.log("ReusableWalletFactory", address(reusableFactory));
        console2.log("DemoShop", address(shop));
    }
}
