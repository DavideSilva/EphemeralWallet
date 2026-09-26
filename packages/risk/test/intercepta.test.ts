import { describe, expect, it, vi } from "vitest";
import { createInterceptaClient, ScreeningUnavailable } from "../src/intercepta";

const ADDR = "0x0d775e010f0b6c32c9468d43ba599ef47d596e47";

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
}

describe("intercepta client", () => {
  it("sends the API key and parses a quick scan", async () => {
    const fetchImpl = fakeFetch(200, { toxicScore: 90, traits: [{ name: "sanction_address", risk: 100, txsCount: 3, description: "OFAC listed" }] });
    const client = createInterceptaClient({ apiKey: "k", fetchImpl });
    const scan = await client.quickScanAddress(ADDR);
    expect(scan.traits[0].name).toBe("sanction_address");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.web3antivirus.io/api/public/v2/extension/account/${ADDR}/quick-scan`);
    expect((init.headers as Record<string, string>)["X-API-KEY"]).toBe("k");
  });

  it("treats a missing traits array as a clean scan", async () => {
    const client = createInterceptaClient({ apiKey: "k", fetchImpl: fakeFetch(200, { toxicScore: 0 }) });
    expect(await client.deepScanAddress(ADDR)).toEqual({ toxicScore: 0, traits: [] });
  });

  it("fails closed on non-2xx", async () => {
    const client = createInterceptaClient({ apiKey: "k", fetchImpl: fakeFetch(500, { error: "boom" }) });
    await expect(client.quickScanAddress(ADDR)).rejects.toBeInstanceOf(ScreeningUnavailable);
  });

  it("fails closed on unparseable body", async () => {
    const client = createInterceptaClient({ apiKey: "k", fetchImpl: fakeFetch(200, "<html>") });
    await expect(client.scanToken(ADDR, "8453")).rejects.toThrow(/unparseable/);
  });

  it("fails closed on network error / timeout", async () => {
    const fetchImpl = vi.fn(async () => { throw new DOMException("timed out", "TimeoutError"); });
    const client = createInterceptaClient({ apiKey: "k", fetchImpl });
    await expect(client.summarizeAddress(ADDR)).rejects.toBeInstanceOf(ScreeningUnavailable);
  });

  it("fails closed when a token scan lacks riskLevel", async () => {
    const client = createInterceptaClient({ apiKey: "k", fetchImpl: fakeFetch(200, { detectors: [] }) });
    await expect(client.scanToken(ADDR, "8453")).rejects.toThrow(/unexpected body/);
  });

  it("posts EIP-712 payloads as a JSON string with the mainnet chain id", async () => {
    const fetchImpl = fakeFetch(200, { riskGroup: "Low", detectors: [] });
    const client = createInterceptaClient({ apiKey: "k", fetchImpl });
    const typedData = { domain: { chainId: 8453 }, types: {}, primaryType: "TransferWithAuthorization", message: { value: 10n } };
    const result = await client.scanMessage({ from: ADDR, chainId: "8453", typedData });
    expect(result.riskGroup).toBe("Low");
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    const body = JSON.parse(init.body as string);
    expect(body.chainId).toBe("8453");
    expect(JSON.parse(body.message).message.value).toBe("10");
  });
});
