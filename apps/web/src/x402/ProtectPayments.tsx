import { useEffect, useState } from "react";
import { Fingerprint } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ownerPasskey, passkeysSupported } from "@/lib/passkey";

const ENROLL = import.meta.env.VITE_ENROLL_URL;

/**
 * Shown while `npm run demo` waits to set up the agent's payment wallet: the owner enrolls their passkey, and setup then
 * creates the payment permission with the Touch ID approval plugin from the start.
 */
export function ProtectPayments() {
  const [state, setState] = useState<"checking" | "waiting" | "sending" | "done" | "gone">(ENROLL ? "checking" : "gone");
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!ENROLL || state !== "checking") return;
    fetch(`${ENROLL}/status`)
      .then(res => setState(res.ok ? "waiting" : "gone"))
      // The endpoint closes once setup has its passkey (or was skipped): nothing to do then.
      .catch(() => setState("gone"));
  }, [state]);

  if (state === "gone" || state === "checking") return null;

  async function protect() {
    setError(undefined);
    setState("sending");
    try {
      // First, before other awaits: Safari only allows the passkey prompt close to the click.
      const passkey = await ownerPasskey();
      const res = await fetch(`${ENROLL}/passkey`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publicKey: passkey.publicKey }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
      setState("done");
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0] : String(e));
      setState("waiting");
    }
  }

  return (
    <div className="mb-8 rounded-xl border border-intaglio/40 bg-intaglio/10 p-5" role="alert">
      {state === "done" ? (
        <p className="font-semibold">
          Payments are protected. Setup is creating the agent's wallet; this page fills in when it's ready.
        </p>
      ) : (
        <>
          <p className="flex items-center gap-2 font-semibold">
            <Fingerprint className="size-5" aria-hidden="true" /> Protect the agent's payments with Touch ID
          </p>
          <p className="mt-1.5 max-w-2xl text-sm">
            The demo is waiting to create the agent's payment wallet. With your passkey on it, the wallet itself refuses
            any payment to a new payee, or over 0.25 USDC, until you approve it with Touch ID.
          </p>
          {!passkeysSupported() && (
            <p className="mt-2 text-sm text-void">
              Passkeys need a browser with Touch ID on http://localhost:5173 (not an IP address).
            </p>
          )}
          {error && <p className="mt-2 text-sm text-void">Couldn't enroll: {error}</p>}
          <Button className="mt-3" onClick={protect} disabled={state === "sending" || !passkeysSupported()}>
            {state === "sending" ? "Waiting for Touch ID…" : "Protect payments with Touch ID"}
          </Button>
        </>
      )}
    </div>
  );
}
