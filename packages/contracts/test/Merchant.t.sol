// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {Merchant} from "../src/Merchant.sol";

contract MerchantTest is Test {
    Merchant merchant;
    address buyer = makeAddr("buyer");

    function setUp() public {
        Merchant.Item[] memory items = new Merchant.Item[](2);
        items[0] = Merchant.Item("Espresso", 0.001 ether);
        items[1] = Merchant.Item("Croissant", 0.002 ether);
        merchant = new Merchant("Cafe", items);
        vm.deal(buyer, 1 ether);
    }

    function testExposesCatalog() public view {
        Merchant.Item[] memory items = merchant.items();
        assertEq(merchant.name(), "Cafe");
        assertEq(items.length, 2);
        assertEq(items[1].name, "Croissant");
        assertEq(items[1].price, 0.002 ether);
    }

    function testBuysQuantityAtCatalogPrice() public {
        vm.expectEmit(true, true, false, true, address(merchant));
        emit Merchant.Purchased(buyer, 1, 3, 0.006 ether);
        vm.prank(buyer);
        merchant.buy{value: 0.006 ether}(1, 3);
    }

    function testRejectsWrongPayment() public {
        vm.expectRevert(Merchant.WrongPayment.selector);
        vm.prank(buyer);
        merchant.buy{value: 0.001 ether}(1, 1);
    }

    function testRejectsUnknownItem() public {
        vm.expectRevert(Merchant.UnknownItem.selector);
        vm.prank(buyer);
        merchant.buy{value: 0.001 ether}(2, 1);
    }

    function testRejectsZeroQuantity() public {
        vm.expectRevert(Merchant.InvalidQuantity.selector);
        vm.prank(buyer);
        merchant.buy(0, 0);
    }
}
