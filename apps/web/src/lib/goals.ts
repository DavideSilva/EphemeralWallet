const key = (cardId: string) => `ephemeral:goal:${cardId}`;

export function savedGoal(cardId: string): string {
  try {
    return localStorage.getItem(key(cardId)) ?? "";
  } catch {
    return "";
  }
}

export function saveGoal(cardId: string, goal: string) {
  try {
    localStorage.setItem(key(cardId), goal);
  } catch {
    // Goals are a convenience; the command still works without storage.
  }
}
