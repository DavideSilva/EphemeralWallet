// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Deliberately simple hackathon demo target.
/// The agent can purchase exactly one named "item" by paying its quoted price.
contract DemoShop {
    error WrongPrice();

    mapping(bytes32 => uint256) public price;
    event Purchased(address indexed buyer, bytes32 indexed item, uint256 paid);

    constructor() {
        price[keccak256("coffee")] = 0.001 ether;
        price[keccak256("ticket")] = 0.002 ether;
    }

    function buy(bytes32 item) external payable {
        if (msg.value != price[item]) revert WrongPrice();
        emit Purchased(msg.sender, item, msg.value);
    }
}
