import { describe, expect, it, vi } from "vitest";
import { ScreeningUnavailable, type Profile } from "../../../packages/risk/src/index";
import { screenMerchant } from "../server/screening";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const profile = (tier: Profile["tier"]): Profile => ({
  address: ADDRESS,
  tier,
  toxicScore: tier === "BLOCKED" ? 100 : 0,
  labels: ["contract"],
  screenedAt: "2026-09-26T00:00:00.000Z",
  reasons: tier === "BLOCKED" ? [{ source: "payee", code: "known_scammer", detail: "Confirmed scams" }] : [],
});

describe("screenMerchant", () => {
  it.each([
    ["TRUSTED", "trusted"],
    ["CAUTION", "caution"],
    ["BLOCKED", "blocked"],
  ] as const)("maps %s to %s", async (tier, status) => {
    const result = await screenMerchant({ getProfile: async () => profile(tier) }, ADDRESS);
    expect(result.status).toBe(status);
    expect(result.labels).toEqual(["contract"]);
  });

  it("keeps the reasons for a blocked merchant", async () => {
    const result = await screenMerchant({ getProfile: async () => profile("BLOCKED") }, ADDRESS);
    expect(result.reasons).toEqual([{ code: "known_scammer", detail: "Confirmed scams" }]);
  });

  it("retries once, then reports unverified instead of trusted", async () => {
    const getProfile = vi.fn(async () => {
      throw new ScreeningUnavailable("quick-scan", "HTTP 503");
    });
    const result = await screenMerchant({ getProfile }, ADDRESS);
    expect(getProfile).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("unverified");
    expect(result.detail).toContain("HTTP 503");
  });

  it("recovers when the retry succeeds", async () => {
    const getProfile = vi
      .fn()
      .mockRejectedValueOnce(new ScreeningUnavailable("deep-scan", "timeout"))
      .mockResolvedValueOnce(profile("TRUSTED"));
    expect((await screenMerchant({ getProfile }, ADDRESS)).status).toBe("trusted");
  });

  it("doesn't retry an address Intercepta has no record of", async () => {
    const getProfile = vi.fn(async () => {
      throw new ScreeningUnavailable("deep-scan", "HTTP 404");
    });
    const result = await screenMerchant({ getProfile }, ADDRESS);
    expect(getProfile).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("unverified");
    expect(result.detail).toBe("Intercepta has no record of this address.");
  });

  it("is unverified without an API key", async () => {
    const result = await screenMerchant(undefined, ADDRESS);
    expect(result.status).toBe("unverified");
    expect(result.detail).toContain("INTERCEPTA_API_KEY");
  });
});
