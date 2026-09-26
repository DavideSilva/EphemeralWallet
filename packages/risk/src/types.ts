export type Address = `0x${string}`;
export type Trait = { name: string; risk: number; txsCount: number; description: string };
export type AddressScan = { toxicScore: number; traits: Trait[] };
export type AddressOverview = { ens?: string; projectName?: string; isContract: boolean; txCount?: number; firstTxDate?: string };
export type TokenScan = { riskLevel: "neutral"|"low"|"medium"|"high"; trust: "whitelist"|"blocklist"|"neutral"; action: "block"|"warn"|"info"; detectors: { code: string; description: string }[] };
export type MessageScan = { riskGroup: "Low"|"Medium"|"High"; detectors: { code: string; description: string }[] };
export type TypedDataPayload = { domain: Record<string, unknown>; types: Record<string, unknown>; primaryType: string; message: Record<string, unknown> };
export type Reason = { source: "payee"|"payer"|"token"|"authorization"|"limits"|"screening"|"owner"; code: string; detail: string };
