import Anthropic from "@anthropic-ai/sdk";

export type CatalogItem = { name: string; price: bigint };
/** How catalog prices are denominated: ETH in wei for shop contracts, USDC (6 decimals) for x402 sellers. */
export type Currency = { symbol: string; decimals: number };
export const ETH: Currency = { symbol: "ETH", decimals: 18 };

export type Plan =
  | { action: "purchase"; itemId: number; quantity: number; reason: string; planner: string }
  | { action: "decline"; reason: string; planner: string };

const MODEL = "claude-opus-5";

const planSchema = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["purchase", "decline"] },
    itemId: { type: "integer", description: "Catalog index of the item to buy. Use 0 when declining." },
    quantity: { type: "integer", description: "How many to buy. Use 0 when declining." },
    reason: { type: "string", description: "One short sentence explaining the choice." },
  },
  required: ["action", "itemId", "quantity", "reason"],
  additionalProperties: false,
};

const system = `You are a purchasing agent. You receive a task from your owner and the catalog of the one merchant you may buy from.
Choose the single catalog item and quantity that best carries out the task, exactly as asked.
You are not told your spending limits; the card you pay with enforces them, so do not shrink the order to guess at a budget.
Decline only when nothing in the catalog fits the task.`;

function catalogText(merchant: string, items: CatalogItem[], currency: Currency) {
  const price = (value: bigint) => `${Number(value) / 10 ** currency.decimals} ${currency.symbol}`;
  return items.map((item, i) => `${i}. ${item.name} (${price(item.price)})`).join("\n") + `\nMerchant: ${merchant}`;
}

export async function planWithClaude(goal: string, merchant: string, items: CatalogItem[], currency = ETH): Promise<Plan> {
  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: planSchema } },
    system,
    messages: [{ role: "user", content: `Catalog:\n${catalogText(merchant, items, currency)}\n\nTask: ${goal}` }],
  });

  if (response.stop_reason === "refusal") {
    return { action: "decline", reason: "The planner declined this task.", planner: response.model };
  }
  const text = response.content.find(block => block.type === "text");
  if (!text || text.type !== "text") throw new Error(`No plan in the response (stop reason: ${response.stop_reason})`);

  const plan = JSON.parse(text.text) as { action: string; itemId: number; quantity: number; reason: string };
  if (plan.action === "decline") return { action: "decline", reason: plan.reason, planner: response.model };
  if (!items[plan.itemId] || !Number.isInteger(plan.quantity) || plan.quantity < 1) {
    throw new Error(`Planner returned an invalid order: ${text.text}`);
  }
  return { action: "purchase", itemId: plan.itemId, quantity: plan.quantity, reason: plan.reason, planner: response.model };
}

const numberWords: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, few: 3,
};

const stem = (word: string) => word.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(es|s)$/, "");

export function planOffline(goal: string, items: CatalogItem[]): Plan {
  const words = goal.split(/\s+/).map(stem).filter(Boolean);
  const scored = items
    .map((item, itemId) => ({
      itemId,
      price: item.price,
      score: item.name.split(/\s+/).map(stem).filter(word => words.includes(word)).length,
    }))
    .sort((a, b) => b.score - a.score || (a.price < b.price ? -1 : 1));

  const best = scored[0];
  if (!best || best.score === 0) {
    return { action: "decline", reason: "Nothing in the catalog matches the task.", planner: "offline" };
  }

  const tokens = goal.toLowerCase().split(/\s+/);
  const quantity =
    tokens.map(t => Number.parseInt(t, 10)).find(n => Number.isInteger(n) && n > 0) ??
    tokens.map(t => numberWords[t]).find(n => n !== undefined) ??
    1;

  return {
    action: "purchase",
    itemId: best.itemId,
    quantity,
    reason: `Matched "${items[best.itemId].name}" from the task wording.`,
    planner: "offline",
  };
}
