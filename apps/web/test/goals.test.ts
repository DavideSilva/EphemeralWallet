import { describe, expect, it } from "vitest";
import { exampleGoal } from "../src/lib/goals";

describe("exampleGoal", () => {
  it("asks for two of the first catalog item", () => {
    expect(exampleGoal([{ name: "Adult ticket" }, { name: "Child ticket" }])).toBe("Buy two adult tickets");
    expect(exampleGoal([{ name: "Onsen day pass" }])).toBe("Buy two onsen day passes");
    expect(exampleGoal([{ name: "Art book" }])).toBe("Buy two art books");
    expect(exampleGoal([{ name: "Kaiseki dinner" }])).toBe("Buy two kaiseki dinners");
  });

  it("keeps proper names capitalised", () => {
    expect(exampleGoal([{ name: "Tokyo Metro day pass" }])).toBe("Buy two Tokyo Metro day passes");
    expect(exampleGoal([{ name: "Mount Fuji weather report" }])).toBe("Buy two Mount Fuji weather reports");
  });

  it("falls back without a catalog", () => {
    expect(exampleGoal(undefined)).toBe("Describe what to buy");
    expect(exampleGoal([])).toBe("Describe what to buy");
  });
});
