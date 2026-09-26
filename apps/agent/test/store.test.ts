import { describe, expect, it } from "vitest";
import { createStore } from "../src/x402/store";

const PAYEE = "0x2222222222222222222222222222222222222222";

describe("store", () => {
  it("lists newest decisions first and tracks paid payees", () => {
    const store = createStore();
    store.addDecision({ url: "a", wallet: PAYEE, permissionId: "0", status: "refused" });
    store.addDecision({ url: "b", wallet: PAYEE, permissionId: "0", status: "settled", payTo: PAYEE });
    expect(store.listDecisions().map(d => d.url)).toEqual(["b", "a"]);
    expect(store.paidBefore("0x2222222222222222222222222222222222222222")).toBe(true);
  });

  it("resolves holds exactly once", () => {
    const store = createStore();
    const hold = store.addHold({ decisionId: "d", url: "u", walletKey: "default", payTo: PAYEE, amount: "300000", reasons: [] });
    expect(store.listHolds()[0].status).toBe("pending");
    store.resolveHold(hold.id, "approved");
    expect(store.getHold(hold.id)?.status).toBe("approved");
    expect(() => store.resolveHold(hold.id, "rejected")).toThrow(/already/);
  });

  it("updates decisions in place and throws on unknown id", () => {
    const store = createStore();
    const decision = store.addDecision({ url: "a", wallet: PAYEE, permissionId: "0", status: "held" });
    const updated = store.updateDecision(decision.id, { status: "superseded", resolvedBy: "new-id" });
    expect(updated.status).toBe("superseded");
    expect(updated.resolvedBy).toBe("new-id");
    expect(store.listDecisions()[0]).toMatchObject({ status: "superseded", resolvedBy: "new-id" });
    expect(() => store.updateDecision("missing", { status: "failed" })).toThrow(/not found/);
  });
});
