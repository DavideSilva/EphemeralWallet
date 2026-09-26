import { describe, expect, it, vi } from "vitest";
import { createProfiler, tierFor } from "../src/profile";
import type { InterceptaClient } from "../src/intercepta";
import { ScreeningUnavailable } from "../src/intercepta";

const A = "0x00000000000000000000000000000000000000aa";
const trait = (name: string, risk = 80) => ({ name, risk, txsCount: 1, description: `${name} desc` });

function fakeClient(traits: ReturnType<typeof trait>[], overview = { isContract: false, ens: "alice.eth" }): InterceptaClient {
  return {
    quickScanAddress: vi.fn(async () => ({ toxicScore: 10, traits })),
    deepScanAddress: vi.fn(async () => ({ toxicScore: 20, traits: [] })),
    summarizeAddress: vi.fn(async () => overview),
    scanToken: vi.fn(),
    scanMessage: vi.fn()
  } as unknown as InterceptaClient;
}

describe("tierFor", () => {
  it("blocks sanctions / scam traits", () => expect(tierFor([trait("sanction_address")], 1)).toBe("BLOCKED"));
  it("cautions on other traits at or above the threshold", () => expect(tierFor([trait("non_kyc_transfers", 30)], 1)).toBe("CAUTION"));
  it("ignores zero-risk traits", () => expect(tierFor([trait("non_kyc_transfers", 0)], 1)).toBe("TRUSTED"));
  it("trusts an empty trait list", () => expect(tierFor([], 1)).toBe("TRUSTED"));
  it("cautions on a high deep-scan toxic score", () => expect(tierFor([], 1, 90)).toBe("CAUTION"));
  it("trusts a low toxic score", () => expect(tierFor([], 1, 10)).toBe("TRUSTED"));
});

describe("createProfiler", () => {
  it("merges scans into a profile with reasons and labels", async () => {
    const profiler = createProfiler(fakeClient([trait("known_scammer")]));
    const profile = await profiler.getProfile(A);
    expect(profile.tier).toBe("BLOCKED");
    expect(profile.toxicScore).toBe(20);
    expect(profile.reasons).toEqual([{ source: "payee", code: "known_scammer", detail: "known_scammer desc" }]);
    expect(profile.labels).toContain("alice.eth");
  });

  it("cautions on a toxic score with no traits and explains why", async () => {
    const client = fakeClient([]);
    (client.quickScanAddress as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ toxicScore: 80, traits: [] });
    const profile = await createProfiler(client).getProfile(A);
    expect(profile.tier).toBe("CAUTION");
    expect(profile.toxicScore).toBe(80);
    expect(profile.reasons).toContainEqual({ source: "payee", code: "toxic_score", detail: "Intercepta toxic score 80" });
  });

  it("labels reasons with the requested source", async () => {
    const profile = await createProfiler(fakeClient([trait("mixer_transfers")])).getProfile(A, "payer");
    expect(profile.reasons[0].source).toBe("payer");
  });

  it("caches within the TTL", async () => {
    const client = fakeClient([]);
    let t = 0;
    const profiler = createProfiler(client, { ttlMs: 1000, now: () => t });
    await profiler.getProfile(A);
    t = 500;
    await profiler.getProfile(A);
    expect(client.quickScanAddress).toHaveBeenCalledTimes(1);
    t = 2000;
    await profiler.getProfile(A);
    expect(client.quickScanAddress).toHaveBeenCalledTimes(2);
  });

  it("evicts the oldest entry beyond maxEntries", async () => {
    const client = fakeClient([]);
    const profiler = createProfiler(client, { maxEntries: 2 });
    const B = "0x00000000000000000000000000000000000000bb";
    const C = "0x00000000000000000000000000000000000000cc";
    await profiler.getProfile(A);
    await profiler.getProfile(B);
    await profiler.getProfile(C);
    await profiler.getProfile(C);
    expect(client.quickScanAddress).toHaveBeenCalledTimes(3);
    await profiler.getProfile(A);
    expect(client.quickScanAddress).toHaveBeenCalledTimes(4);
  });

  it("propagates ScreeningUnavailable and does not cache failures", async () => {
    const client = fakeClient([]);
    (client.quickScanAddress as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new ScreeningUnavailable("quick-scan", "HTTP 500"));
    const profiler = createProfiler(client);
    await expect(profiler.getProfile(A)).rejects.toBeInstanceOf(ScreeningUnavailable);
    await expect(profiler.getProfile(A)).resolves.toMatchObject({ tier: "TRUSTED" });
  });
});

import { existsSync, readFileSync } from "node:fs";

const fixtureUrl = new URL("./fixtures/live.json", import.meta.url);
const hasLiveFixture = existsSync(fixtureUrl);
// Guard the read: vitest evaluates a describe body during collection even when
// runIf's condition is false, so an unguarded readFileSync here would throw and
// fail the suite instead of cleanly skipping the nested its.
describe.runIf(hasLiveFixture)("recorded live responses", () => {
  const live = hasLiveFixture ? JSON.parse(readFileSync(fixtureUrl, "utf8")) : undefined;
  it("tiers the Discord risky address as BLOCKED", () => {
    expect(tierFor(
      [...live.riskyQuick.traits, ...live.riskyDeep.traits],
      1,
      Math.max(live.riskyQuick.toxicScore ?? 0, live.riskyDeep.toxicScore ?? 0)
    )).toBe("BLOCKED");
  });
  it("tiers the clean payee as TRUSTED", () => {
    expect(tierFor(
      [...live.cleanQuick.traits, ...live.cleanDeep.traits],
      1,
      Math.max(live.cleanQuick.toxicScore ?? 0, live.cleanDeep.toxicScore ?? 0)
    )).toBe("TRUSTED");
  });
});
