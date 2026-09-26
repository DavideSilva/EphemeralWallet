import type { AgentAction, Mission } from "../../../packages/shared/src/mission";

export function validateAction(mission: Mission, action: AgentAction, now: bigint) {
  if (mission.used) throw new Error("mission already consumed");
  if (now > mission.expiresAt) throw new Error("mission expired");
  if (action.target.toLowerCase() !== mission.allowedTarget.toLowerCase()) {
    throw new Error("target not allowed");
  }
  if (action.value > mission.maxSpend) throw new Error("spend limit exceeded");
}

// Next step: plug an LLM/tool loop in here that converts an objective into
// a candidate transaction, validates it locally, then submits via the agent key.
