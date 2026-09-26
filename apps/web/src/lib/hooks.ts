import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection, useWatchBlockNumber } from "wagmi";
import { fetchMerchants, fetchSnapshot, type Merchant } from "./data";

export function useMerchants() {
  return useQuery({ queryKey: ["merchants"], queryFn: fetchMerchants, staleTime: Infinity });
}

export function useMerchant(address: string | undefined): Merchant | undefined {
  const { data } = useMerchants();
  return data?.find(m => m.address.toLowerCase() === address?.toLowerCase());
}

export function useSnapshot() {
  const { address } = useConnection();
  const merchants = useMerchants();
  return useQuery({
    queryKey: ["snapshot", address],
    queryFn: () => fetchSnapshot(address!, merchants.data!),
    enabled: Boolean(address && merchants.data),
    // Expiry is wall-clock based, so re-derive card status even when no blocks arrive.
    refetchInterval: 15_000,
  });
}

export function useChainRefresh() {
  const queryClient = useQueryClient();
  useWatchBlockNumber({
    onBlockNumber: () => queryClient.invalidateQueries({ queryKey: ["snapshot"] }),
  });
}
