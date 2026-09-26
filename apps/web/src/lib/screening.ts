import { useQuery } from "@tanstack/react-query";
import { isAddress } from "viem";
import type { ScreeningResponse } from "../../server/screening";

export type { ScreeningResponse, ScreeningStatus } from "../../server/screening";

async function screen(address: string): Promise<ScreeningResponse> {
  const response = await fetch(`/api/screen/${address}`);
  if (!response.ok) throw new Error(`Merchant check failed (HTTP ${response.status})`);
  return response.json();
}

export function useScreening(address: string | undefined) {
  return useQuery({
    queryKey: ["screening", address?.toLowerCase()],
    queryFn: () => screen(address!),
    enabled: Boolean(address && isAddress(address)),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

const key = (cardId: string) => `ephemeral:screening:${cardId}`;

export function saveScreening(cardId: string, result: ScreeningResponse) {
  try {
    localStorage.setItem(key(cardId), JSON.stringify(result));
  } catch {
    // Only used to show the check again on the card page.
  }
}

export function savedScreening(cardId: string): ScreeningResponse | undefined {
  try {
    const raw = localStorage.getItem(key(cardId));
    return raw ? (JSON.parse(raw) as ScreeningResponse) : undefined;
  } catch {
    return undefined;
  }
}
