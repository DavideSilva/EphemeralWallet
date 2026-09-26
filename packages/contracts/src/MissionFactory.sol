// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EphemeralMissionWallet} from "./EphemeralMissionWallet.sol";

contract MissionFactory {
    event MissionCreated(
        address indexed owner,
        address indexed agent,
        address indexed wallet,
        address allowedTarget,
        uint256 maxSpend,
        uint64 expiresAt,
        uint256 fundedAmount
    );

    function createMission(
        address agent,
        address allowedTarget,
        uint256 maxSpend,
        uint64 expiresAt
    ) external payable returns (address wallet) {
        require(agent != address(0), "agent=0");
        require(allowedTarget != address(0), "target=0");
        require(expiresAt > block.timestamp, "expired");
        require(maxSpend <= msg.value, "budget>funding");

        EphemeralMissionWallet mission = new EphemeralMissionWallet{value: msg.value}(
            msg.sender,
            agent,
            allowedTarget,
            maxSpend,
            expiresAt
        );

        wallet = address(mission);
        emit MissionCreated(
            msg.sender, agent, wallet, allowedTarget, maxSpend, expiresAt, msg.value
        );
    }
}
