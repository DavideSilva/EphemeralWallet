import { describe, expect, it } from "vitest";
import { exampleGoal } from "../src/lib/goals";

describe("exampleGoal", () => {
  it("builds a task from the first catalog item", () => {
    expect(exampleGoal([{ name: "Child ticket" }, { name: "Adult ticket" }])).toBe("Buy a child ticket");
    expect(exampleGoal([{ name: "Onsen day pass" }])).toBe("Buy an onsen day pass");
    expect(exampleGoal([{ name: "Room with Fuji view" }])).toBe("Buy a room with Fuji view");
  });

  it("keeps proper names capitalised", () => {
    expect(exampleGoal([{ name: "Tokyo Metro day pass" }])).toBe("Buy a Tokyo Metro day pass");
    expect(exampleGoal([{ name: "Mount Fuji weather report" }])).toBe("Buy a Mount Fuji weather report");
  });

  it("falls back without a catalog", () => {
    expect(exampleGoal(undefined)).toBe("Describe what to buy");
    expect(exampleGoal([])).toBe("Describe what to buy");
  });
});
