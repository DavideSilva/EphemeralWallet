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

/** "Buy a child ticket", from the merchant's first catalog item. Keeps proper names ("Tokyo Metro day pass") capitalised. */
export function exampleGoal(items: readonly { name: string }[] | undefined): string {
  const name = items?.[0]?.name;
  if (!name) return "Describe what to buy";
  const [first, second] = name.split(/\s+/);
  const item = second && /^[A-Z]/.test(second) ? name : first.toLowerCase() + name.slice(first.length);
  return `Buy ${/^[aeiou]/i.test(item) ? "an" : "a"} ${item}`;
}
