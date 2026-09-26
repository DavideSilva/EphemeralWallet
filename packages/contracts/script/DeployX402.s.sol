// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {ReusableWalletFactory} from "../src/ReusableWalletFactory.sol";

contract DeployX402 is Script {
    function run() external returns (ReusableWalletFactory factory) {
        vm.startBroadcast();
        factory = new ReusableWalletFactory();
        vm.stopBroadcast();
        console2.log("ReusableWalletFactory", address(factory));
    }
}
