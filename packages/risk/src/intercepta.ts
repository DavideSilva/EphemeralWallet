import type { Address, AddressOverview, AddressScan, MessageScan, TokenScan, Trait, TypedDataPayload } from "./types";

/** Any failure to get a trustworthy answer from Intercepta. Callers must fail closed. */
export class ScreeningUnavailable extends Error {
  constructor(readonly check: string, message: string) {
    super(`${check}: ${message}`);
    this.name = "ScreeningUnavailable";
  }
}

export type InterceptaClient = {
  quickScanAddress(address: Address): Promise<AddressScan>;
  deepScanAddress(address: Address): Promise<AddressScan>;
  summarizeAddress(address: Address): Promise<AddressOverview>;
  scanToken(address: Address, chainId: string): Promise<TokenScan>;
  scanMessage(input: { from: Address; chainId: string; typedData: TypedDataPayload }): Promise<MessageScan>;
};

type Options = { apiKey: string; baseUrl?: string; timeoutMs?: number; fetchImpl?: typeof fetch };

function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Error("not an object");
  return body as Record<string, unknown>;
}

function parseAddressScan(body: unknown): AddressScan {
  const o = asObject(body);
  const toxicScoreOk = typeof o.toxicScore === "number";
  const traitsOk = Array.isArray(o.traits);
  if (!toxicScoreOk && !traitsOk) throw new Error("missing toxicScore and traits");
  const traits = traitsOk ? (o.traits as Trait[]) : [];
  return {
    toxicScore: toxicScoreOk ? (o.toxicScore as number) : 0,
    traits: traits.map(t => {
      const risk = Number(t.risk ?? 0);
      if (!Number.isFinite(risk)) throw new Error("trait risk is not a finite number");
      return { name: String(t.name), risk, txsCount: Number(t.txsCount ?? 0), description: String(t.description ?? t.name) };
    })
  };
}

function parseOverview(body: unknown): AddressOverview {
  const o = asObject(body);
  const project = o.project as { name?: string } | undefined;
  return {
    ens: typeof o.ens === "string" && o.ens ? o.ens : undefined,
    projectName: project?.name || undefined,
    isContract: Boolean(o.isContract),
    txCount: typeof o.txCount === "number" ? o.txCount : undefined,
    firstTxDate: typeof o.firstTxDate === "string" ? o.firstTxDate : undefined
  };
}

function parseDetectors(value: unknown) {
  return Array.isArray(value) ? value.map(d => ({ code: String(d.code), description: String(d.description ?? d.code) })) : [];
}

/** Case-insensitive whitelist match returning the canonical spelling; anything else throws (fail closed). */
function oneOf<T extends string>(field: string, value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string") throw new Error(`missing ${field}`);
  const match = allowed.find(a => a.toLowerCase() === value.toLowerCase());
  if (!match) throw new Error(`unknown ${field} ${JSON.stringify(value)}`);
  return match;
}

/**
 * `riskLevel` is required. `trust`/`action` are optional in Intercepta's responses, so a missing one
 * reads as neutral/info (no extra signal) and a present-but-unknown one fails closed. The agent never
 * relies on them alone: a payment also needs `tokenIsCanonical` (the asset must be the chain's USDC).
 */
function parseToken(body: unknown): TokenScan {
  const o = asObject(body);
  return {
    riskLevel: oneOf("riskLevel", o.riskLevel, ["neutral", "low", "medium", "high"] as const),
    trust: o.trust === undefined || o.trust === null ? "neutral" : oneOf("trust", o.trust, ["whitelist", "blocklist", "neutral"] as const),
    action: o.action === undefined || o.action === null ? "info" : oneOf("action", o.action, ["block", "warn", "info"] as const),
    detectors: parseDetectors(o.detectors)
  };
}

function parseMessage(body: unknown): MessageScan {
  const o = asObject(body);
  return { riskGroup: oneOf("riskGroup", o.riskGroup, ["Low", "Medium", "High"] as const), detectors: parseDetectors(o.detectors) };
}

const jsonReplacer = (_key: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value);

export function createInterceptaClient(opts: Options): InterceptaClient {
  const baseUrl = opts.baseUrl ?? "https://api.web3antivirus.io";
  const timeoutMs = opts.timeoutMs ?? 5000;
  const doFetch = opts.fetchImpl ?? fetch;

  const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
  /** Path parameters must be real addresses: never let a crafted value steer our API key to another endpoint. */
  function checked(check: string, address: string): Promise<void> {
    return ADDRESS_RE.test(address) ? Promise.resolve() : Promise.reject(new ScreeningUnavailable(check, "invalid address"));
  }

  async function call<T>(check: string, path: string, parse: (body: unknown) => T, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { "X-API-KEY": opts.apiKey, accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body, jsonReplacer),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      throw new ScreeningUnavailable(check, error instanceof Error ? error.message : String(error));
    }
    if (!response.ok) throw new ScreeningUnavailable(check, `HTTP ${response.status}`);
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new ScreeningUnavailable(check, "unparseable body");
    }
    try {
      return parse(json);
    } catch (error) {
      throw new ScreeningUnavailable(check, `unexpected body: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    quickScanAddress: address =>
      checked("quick-scan", address).then(() => call("quick-scan", `/api/public/v2/extension/account/${address}/quick-scan`, parseAddressScan)),
    deepScanAddress: address =>
      checked("deep-scan", address).then(() => call("deep-scan", `/api/public/v2/extension/account/${address}/toxic-score`, parseAddressScan)),
    summarizeAddress: address =>
      checked("summarize", address).then(() => call("summarize", `/api/public/v1/extension/security/${address}/overview`, parseOverview)),
    scanToken: (address, chainId) =>
      checked("scan-token", address).then(() =>
        call("scan-token", `/api/public/v2/extension/token-intelligence/token/${address}/risks?chainId=${chainId}`, parseToken)
      ),
    scanMessage: ({ from, chainId, typedData }) =>
      call("scan-message", "/api/public/v2/extension/analysis/signature", parseMessage, {
        from,
        chainId,
        message: JSON.stringify(typedData, jsonReplacer)
      })
  };
}
