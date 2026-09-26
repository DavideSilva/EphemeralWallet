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

const plural = (word: string) =>
  /(s|x|ch|sh)$/.test(word) ? `${word}es` : /[^aeiou]y$/.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`;

/** "Buy two adult tickets", from the merchant's first catalog item. Keeps proper names ("Tokyo Metro day pass") capitalised. */
export function exampleGoal(items: readonly { name: string }[] | undefined): string {
  const name = items?.[0]?.name;
  if (!name) return "Describe what to buy";
  const words = name.split(/\s+/);
  if (!(words[1] && /^[A-Z]/.test(words[1]))) words[0] = words[0].toLowerCase();
  words[words.length - 1] = plural(words[words.length - 1]);
  return `Buy two ${words.join(" ")}`;
}
