// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract EphemeralMissionWallet {
    error NotOwner();
    error NotAgent();
    error MissionAlreadyUsed();
    error MissionExpired();
    error InvalidTarget();
    error SpendLimitExceeded();
    error MissionStillActive();
    error TransferFailed();
    error CallFailed(bytes data);

    address public immutable owner;
    address public immutable agent;
    address public immutable allowedTarget;
    uint256 public immutable maxSpend;
    uint64 public immutable expiresAt;

    bool public used;

    event Executed(address indexed agent, address indexed target, uint256 value, bytes data);
    event Reclaimed(address indexed owner, uint256 amount);

    constructor(
        address owner_,
        address agent_,
        address allowedTarget_,
        uint256 maxSpend_,
        uint64 expiresAt_
    ) payable {
        owner = owner_;
        agent = agent_;
        allowedTarget = allowedTarget_;
        maxSpend = maxSpend_;
        expiresAt = expiresAt_;
    }

    receive() external payable {}

    function execute(address target, uint256 value, bytes calldata data)
        external
        returns (bytes memory result)
    {
        if (msg.sender != agent) revert NotAgent();
        if (used) revert MissionAlreadyUsed();
        if (block.timestamp > expiresAt) revert MissionExpired();
        if (target != allowedTarget) revert InvalidTarget();
        if (value > maxSpend) revert SpendLimitExceeded();

        // Consume authority before the external call to prevent re-entrant reuse.
        used = true;

        (bool ok, bytes memory returnData) = target.call{value: value}(data);
        if (!ok) revert CallFailed(returnData);

        emit Executed(msg.sender, target, value, data);
        return returnData;
    }

    function reclaim() external {
        if (msg.sender != owner) revert NotOwner();
        if (!used && block.timestamp <= expiresAt) revert MissionStillActive();

        uint256 amount = address(this).balance;
        (bool ok,) = owner.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Reclaimed(owner, amount);
    }
}
