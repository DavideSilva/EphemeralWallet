import { randomUUID } from "node:crypto";
import type { Hex } from "viem";
import type { Address, Profile, Reason, VerdictKind } from "@eaw/risk";

export type DecisionStatus = "settled" | "refused" | "held" | "rejected_by_payee" | "failed";
export type Decision = {
  id: string;
  createdAt: string;
  url: string;
  wallet: Address;
  permissionId: string;
  payTo?: Address;
  amount?: string;
  verdict?: { kind: VerdictKind; reasons: Reason[]; cap?: string };
  payee?: Profile;
  status: DecisionStatus;
  approveTx?: Hex;
  settleTx?: string;
  error?: string;
  holdId?: string;
};
export type Hold = {
  id: string;
  decisionId: string;
  url: string;
  walletKey: "default" | "risky";
  payTo: Address;
  amount: string;
  reasons: Reason[];
  status: "pending" | "approved" | "rejected";
};

export function createStore() {
  const decisions: Decision[] = [];
  const holds = new Map<string, Hold>();
  return {
    addDecision(d: Omit<Decision, "id" | "createdAt">): Decision {
      const decision = { ...d, id: randomUUID(), createdAt: new Date().toISOString() };
      decisions.unshift(decision);
      return decision;
    },
    listDecisions: () => [...decisions],
    addHold(h: Omit<Hold, "id" | "status">): Hold {
      const hold: Hold = { ...h, id: randomUUID(), status: "pending" };
      holds.set(hold.id, hold);
      return hold;
    },
    getHold: (id: string) => holds.get(id),
    resolveHold(id: string, status: "approved" | "rejected"): Hold {
      const hold = holds.get(id);
      if (!hold) throw new Error("hold not found");
      if (hold.status !== "pending") throw new Error(`hold already ${hold.status}`);
      hold.status = status;
      return hold;
    },
    listHolds: () => [...holds.values()].reverse(),
    paidBefore: (payTo: Address) =>
      decisions.some(d => d.status === "settled" && d.payTo?.toLowerCase() === payTo.toLowerCase())
  };
}
