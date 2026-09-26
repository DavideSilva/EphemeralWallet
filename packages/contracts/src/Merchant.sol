// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Demo merchant with an on-chain catalog the agent can read to plan purchases.
contract Merchant {
    error UnknownItem();
    error InvalidQuantity();
    error WrongPayment();

    struct Item {
        string name;
        uint256 price;
    }

    string public name;
    Item[] private catalog;

    event Purchased(address indexed buyer, uint256 indexed itemId, uint256 quantity, uint256 paid);

    constructor(string memory name_, Item[] memory items_) {
        name = name_;
        for (uint256 i = 0; i < items_.length; i++) {
            catalog.push(items_[i]);
        }
    }

    function items() external view returns (Item[] memory) {
        return catalog;
    }

    function buy(uint256 itemId, uint256 quantity) external payable {
        if (itemId >= catalog.length) revert UnknownItem();
        if (quantity == 0) revert InvalidQuantity();
        if (msg.value != catalog[itemId].price * quantity) revert WrongPayment();
        emit Purchased(msg.sender, itemId, quantity, msg.value);
    }
}
