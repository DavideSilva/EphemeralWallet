import type { InterceptaClient } from "./intercepta";
import type { Address, Reason, Trait } from "./types";

export type Tier = "TRUSTED" | "CAUTION" | "BLOCKED";
export type Profile = { address: Address; tier: Tier; toxicScore: number; reasons: Reason[]; labels: string[]; screenedAt: string };
export type Profiler = { getProfile(address: Address, source?: "payee" | "payer"): Promise<Profile> };

/** Traits that mean sanctions, stolen funds or scam exposure: never pay, never serve. */
export const BLOCKING_TRAITS: ReadonlySet<string> = new Set([
  "sanction_address",
  "sanction_address_communication",
  "known_scammer",
  "initiator_scam_transactions",
  "attack_money_target",
  "fake_phishing_transfer",
  "fake_phishing_contract_communication",
  "blacklist",
  "mixer_transfers"
]);

export function tierFor(traits: Trait[], cautionMinRisk: number, toxicScore = 0, toxicCautionMin = 50): Tier {
  if (traits.some(t => BLOCKING_TRAITS.has(t.name))) return "BLOCKED";
  if (traits.some(t => t.risk >= cautionMinRisk) || toxicScore >= toxicCautionMin) return "CAUTION";
  return "TRUSTED";
}

function mergeTraits(...lists: Trait[][]): Trait[] {
  const byName = new Map<string, Trait>();
  for (const trait of lists.flat()) {
    const existing = byName.get(trait.name);
    if (!existing || trait.risk > existing.risk) byName.set(trait.name, trait);
  }
  return [...byName.values()].sort((a, b) => b.risk - a.risk);
}

export function createProfiler(
  client: InterceptaClient,
  opts: { ttlMs?: number; maxEntries?: number; cautionMinRisk?: number; toxicCautionMin?: number; now?: () => number } = {}
): Profiler {
  const ttlMs = opts.ttlMs ?? 5 * 60_000;
  // Bounded: profiles are requested for arbitrary addresses (daemon /profiles, service /risk).
  const maxEntries = opts.maxEntries ?? 1000;
  const cautionMinRisk = opts.cautionMinRisk ?? 1;
  const toxicCautionMin = opts.toxicCautionMin ?? 50;
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { at: number; scan: Omit<Profile, "reasons"> & { traits: Trait[] } }>();

  async function scan(address: Address) {
    const key = address.toLowerCase();
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.scan;
    const [quick, deep, overview] = await Promise.all([
      client.quickScanAddress(address),
      client.deepScanAddress(address),
      client.summarizeAddress(address)
    ]);
    const traits = mergeTraits(quick.traits, deep.traits);
    const labels = [overview.ens, overview.projectName, overview.isContract ? "contract" : undefined].filter(
      (label): label is string => Boolean(label)
    );
    const toxicScore = Math.max(quick.toxicScore, deep.toxicScore);
    const result = {
      address,
      tier: tierFor(traits, cautionMinRisk, toxicScore, toxicCautionMin),
      toxicScore,
      labels,
      traits,
      screenedAt: new Date(now()).toISOString()
    };
    cache.delete(key);
    cache.set(key, { at: now(), scan: result });
    if (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
    return result;
  }

  return {
    async getProfile(address, source = "payee") {
      const { traits, ...rest } = await scan(address);
      const reasons: Reason[] = traits.map(t => ({ source, code: t.name, detail: t.description }));
      if (rest.toxicScore >= toxicCautionMin) reasons.push({ source, code: "toxic_score", detail: `Intercepta toxic score ${rest.toxicScore}` });
      return { ...rest, reasons };
    }
  };
}
