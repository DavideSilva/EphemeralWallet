import { useEffect, useState } from "react";
import { slice, type Address, type Hex } from "viem";
import { waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { approvalHookAbi, reusableWalletAbi } from "@shared/abis";
import { Button } from "@/components/ui/button";
import { publicClient, wagmiConfig } from "@/lib/chain";
import { approvalHook } from "@/lib/config";
import { signWithPasskey, storedPasskey } from "@/lib/passkey";

export type HeldPayment = { id: string; wallet?: Address; permissionId?: string; payTo: Address; amount: string };

type Prepared =
  | { mode: "owner" }
  | { mode: "passkey"; validUntil: bigint; challenge: Hex }
  | { mode: "wrong-passkey" };

/**
 * Works out whether the paying wallet needs the owner's Touch ID for this payment and, if so, reads the challenge ahead
 * of the click (Safari only allows the passkey prompt right after a click). Refreshed every few minutes so the signed
 * expiry never goes stale.
 */
async function prepare(hold: HeldPayment): Promise<Prepared> {
  const hook = approvalHook();
  if (!hook || !hold.wallet || hold.permissionId === undefined) return { mode: "owner" };
  const permissionId = BigInt(hold.permissionId);
  const hooks = await publicClient.readContract({ address: hold.wallet, abi: reusableWalletAbi, functionName: "hooksOf", args: [permissionId] });
  const attached = hooks.find(h => h.hook.toLowerCase() === hook.toLowerCase());
  // A passkey config also carries the key (and here the payee flag): more than one word.
  if (!attached || attached.config.length <= 66) return { mode: "owner" };
  const stored = storedPasskey();
  if (stored?.publicKey.toLowerCase() !== slice(attached.config, 32, 96).toLowerCase()) return { mode: "wrong-passkey" };

  const block = await publicClient.getBlock();
  const validUntil = BigInt(Math.max(Math.floor(Date.now() / 1000), Number(block.timestamp)) + 60 * 60);
  const challenge = await publicClient.readContract({
    address: hook,
    abi: approvalHookAbi,
    functionName: "challenge",
    args: [hold.wallet, permissionId, hold.payTo, BigInt(hold.amount), "0x", validUntil],
  });
  return { mode: "passkey", validUntil, challenge };
}

/**
 * Touch ID signs "pay this payee this amount" and the app records it on-chain (anyone may relay; the wallet's plugin
 * checks the passkey signature). Then the agent daemon retries the payment, which the wallet now lets through once.
 */
async function approveOnChain(hold: HeldPayment, prepared: Extract<Prepared, { mode: "passkey" }>) {
  const passkey = storedPasskey()!;
  const auth = await signWithPasskey(passkey, prepared.challenge);
  const hash = await writeContract(wagmiConfig, {
    address: approvalHook()!,
    abi: approvalHookAbi,
    functionName: "approveWithPasskey",
    args: [hold.wallet!, BigInt(hold.permissionId!), hold.payTo, BigInt(hold.amount), "0x", prepared.validUntil, auth],
  });
  const receipt = await waitForTransactionReceipt(wagmiConfig, { hash });
  if (receipt.status !== "success") throw new Error("The Touch ID approval wasn't accepted on-chain");
}

export function HoldActions({
  hold,
  busy,
  onApprove,
  onReject,
  onError,
}: {
  hold: HeldPayment;
  busy: boolean;
  onApprove: () => Promise<void>;
  onReject: () => void;
  onError: (message: string) => void;
}) {
  const [prepared, setPrepared] = useState<Prepared>();
  const [signing, setSigning] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () => prepare(hold).then(p => live && setPrepared(p)).catch(e => live && onError(`Couldn't prepare the approval: ${e.message}`));
    load();
    const timer = setInterval(load, 5 * 60_000);
    return () => { live = false; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hold.id]);

  async function approve() {
    if (prepared?.mode !== "passkey") return onApprove();
    setSigning(true);
    try {
      await approveOnChain(hold, prepared);
      await onApprove();
    } catch (e) {
      onError(e instanceof Error ? e.message.split("\n")[0] : String(e));
    } finally {
      setSigning(false);
      // Each approval moves the plugin's nonce: prepare a fresh challenge for any later retry.
      prepare(hold).then(setPrepared).catch(() => {});
    }
  }

  const waiting = busy || signing || !prepared;
  return (
    <div className="mt-3 space-y-2">
      {prepared?.mode === "wrong-passkey" && (
        <p className="text-sm text-void">
          This wallet is protected by a passkey this browser doesn't have. Approve from the browser you enrolled with.
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" disabled={waiting || prepared?.mode === "wrong-passkey"} onClick={approve}>
          {signing ? "Waiting for Touch ID…" : prepared?.mode === "passkey" ? "Approve with Touch ID" : "Approve"}
        </Button>
        <Button size="sm" variant="outline" disabled={busy || signing} onClick={onReject}>
          Reject
        </Button>
      </div>
    </div>
  );
}
