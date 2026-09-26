import { useEffect, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const AGENT = import.meta.env.VITE_AGENT_URL ?? "http://localhost:4100";
const SERVICE = import.meta.env.VITE_SERVICE_URL ?? "http://localhost:4021";
const WEATHER = import.meta.env.VITE_WEATHER_URL ?? "http://localhost:4022";
const EXPLORER = "https://sepolia.basescan.org/tx/";
const CLEARED_KEY = "x402-feed-cleared-at";

type Reason = { source: string; code: string; detail: string };
type Profile = { address: string; tier: "TRUSTED" | "CAUTION" | "BLOCKED"; toxicScore: number; reasons: Reason[]; labels: string[]; screenedAt: string };
type Decision = {
  id: string; createdAt: string; url: string; wallet: string; payTo?: string; amount?: string; status: string;
  verdict?: { kind: string; reasons: Reason[]; cap?: string }; payee?: Profile; approveTx?: string; validBefore?: string; settleTx?: string; error?: string;
};
type Hold = { id: string; url: string; payTo: string; amount: string; reasons: Reason[]; status: string };
type PayerLogEntry = { at: string; payer: string; outcome: string; reasons: Reason[] };
type WalletStatus = { key: string; wallet: string; maxSpend: string; spent: string; balance: string; uses: number; maxUses: number; expiresAt: number; revoked: boolean };

const usdc = (amount?: string) => (amount ? `${Number(amount) / 1e6} USDC` : "");
const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
const pathOf = (url: string) => {
  try { return new URL(url).pathname; } catch { return url; }
};

// Stamps share the card look: green for go, violet for waiting/caution, red for stop, grey for history.
const tone = {
  go: "border-banknote text-banknote",
  wait: "border-intaglio text-intaglio",
  stop: "border-void text-void",
  muted: "border-ink/40 text-ink/60",
} as const;
type Tone = keyof typeof tone;

// What actually happened to a payment, which is not always the agent's verdict:
// the agent can say PAY and the seller can still refuse the money.
const outcomes: Record<string, { label: string; tone: Tone }> = {
  settled: { label: "Paid", tone: "go" },
  refused: { label: "Blocked by agent", tone: "stop" },
  held: { label: "Waiting for you", tone: "wait" },
  superseded: { label: "Approved by you", tone: "muted" },
  rejected_by_payee: { label: "Refused by seller", tone: "stop" },
  failed: { label: "Failed", tone: "stop" },
  // Approved on-chain (budget spent) but settlement unconfirmed: it can still go through until it expires.
  unsettled: { label: "Not confirmed", tone: "wait" },
};
const tierTone: Record<Profile["tier"], Tone> = { TRUSTED: "go", CAUTION: "wait", BLOCKED: "stop" };

const actions = [
  { title: "Buy from a clean seller", detail: "0.01 USDC · /dataset", body: { url: `${SERVICE}/dataset` }, primary: true },
  { title: "Buy from a flagged seller", detail: "0.01 USDC · /premium-dataset", body: { url: `${SERVICE}/premium-dataset` } },
  { title: "Make a large purchase", detail: "0.30 USDC · /bulk-dataset", body: { url: `${SERVICE}/bulk-dataset` } },
  { title: "Pay from a sanctioned wallet", detail: "0.01 USDC · /dataset, risky wallet", body: { url: `${SERVICE}/dataset`, wallet: "risky" } },
  { title: "Buy a Mount Fuji weather report", detail: "0.01 USDC · another seller", body: { url: `${WEATHER}/weather/mount-fuji` } },
];

function Stamp({ label, tone: t }: { label: string; tone: Tone }) {
  return (
    <span className={cn("inline-block -rotate-2 rounded-sm border-2 border-double px-2 pt-0.5 font-display text-sm uppercase tracking-[0.16em]", tone[t])}>
      {label}
    </span>
  );
}

function Reasons({ reasons }: { reasons: Reason[] }) {
  return (
    <ul className="mt-2 space-y-1 text-sm">
      {reasons.map((r, i) => (
        <li key={i}>
          <span className="rounded bg-paper-deep px-1.5 py-0.5 font-mono text-xs">{r.code}</span>{" "}
          <span className="text-muted-foreground">{r.detail}</span>
        </li>
      ))}
    </ul>
  );
}

function Entry({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-xl border border-border bg-card p-4 shadow-xs", className)}>{children}</div>;
}

function Section({ title, blurb, action, children }: { title: string; blurb: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="font-display text-2xl sm:text-3xl">{title}</h2>
        {action}
      </div>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{blurb}</p>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

// The seller's refusal arrives as one long string ("payer_refused: owner 0x…: reason, reason, …").
function SellerRefusal({ error }: { error: string }) {
  const refused = error.match(/^payer_refused: (\w+) (0x[0-9a-fA-F]{40})/);
  const summary = refused
    ? `The seller refused this wallet's money: its ${refused[1]} ${short(refused[2])} is flagged by Intercepta.`
    : error.startsWith("payer_screening_unavailable")
      ? "The seller couldn't screen this wallet (Intercepta unavailable), so it refused the payment."
      : error;
  return (
    <div className="mt-2 text-sm">
      <p className="text-void">{summary}</p>
      {summary !== error && (
        <details className="mt-1 text-muted-foreground">
          <summary className="cursor-pointer select-none">Seller's full reason</summary>
          <p className="mt-1 break-words">{error}</p>
        </details>
      )}
    </div>
  );
}

function WalletCard({ status }: { status: WalletStatus }) {
  const risky = status.key === "risky";
  return (
    <Entry className="flex-1">
      <p className="text-sm font-medium">{risky ? "Risky wallet (owned by a sanctioned address)" : "Agent wallet"}</p>
      <p className="mt-1 font-mono text-xs text-muted-foreground">{status.wallet}</p>
      <p className="mt-3 text-2xl">
        {usdc(status.balance)} <span className="text-sm text-muted-foreground">in the wallet</span>
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Budget: {usdc(status.spent)} used of {usdc(status.maxSpend)} · {status.uses}/{status.maxUses} payments
        {status.revoked && " · revoked"}
      </p>
    </Entry>
  );
}

function readClearedAt(): number {
  try {
    return Number(localStorage.getItem(CLEARED_KEY) ?? 0);
  } catch {
    return 0;
  }
}

export function PaymentsPanel() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [holds, setHolds] = useState<Hold[]>([]);
  const [payerLog, setPayerLog] = useState<PayerLogEntry[]>([]);
  const [wallets, setWallets] = useState<WalletStatus[]>([]);
  const [lookup, setLookup] = useState("");
  const [profile, setProfile] = useState<Profile>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [clearedAt, setClearedAt] = useState(readClearedAt);

  async function refresh() {
    const [d, h, p, w] = await Promise.all([
      fetch(`${AGENT}/decisions`).then(r => r.json()),
      fetch(`${AGENT}/holds`).then(r => r.json()),
      fetch(`${SERVICE}/decisions`).then(r => r.json()).catch(() => []),
      fetch(`${AGENT}/wallets`).then(r => (r.ok ? r.json() : [])).catch(() => []),
    ]);
    setDecisions(d); setHolds(h); setPayerLog(p); setWallets(w);
  }
  useEffect(() => {
    refresh().catch(() => {});
    const t = setInterval(() => refresh().catch(() => {}), 2000);
    return () => clearInterval(t);
  }, []);

  async function post(path: string, body?: unknown) {
    setBusy(true);
    try {
      const r = await fetch(`${AGENT}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
      if (!r.ok) { const data = await r.json().catch(() => undefined); setError(data?.error ?? `HTTP ${r.status}`); return; }
      setError(undefined);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function screen() {
    try {
      const r = await fetch(`${SERVICE}/risk/${lookup}`);
      if (!r.ok) { const data = await r.json().catch(() => undefined); setError(data?.error ?? `HTTP ${r.status}`); return; }
      setError(undefined);
      setProfile(await r.json());
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  function clearFeed() {
    const now = Date.now();
    setClearedAt(now);
    setProfile(undefined);
    try { localStorage.setItem(CLEARED_KEY, String(now)); } catch { /* the in-memory clear still applies */ }
  }

  // "Clear feed" only hides history in this browser; pending holds always stay visible.
  const visible = decisions.filter(d => Date.parse(d.createdAt) > clearedAt);
  const visibleLog = payerLog.filter(e => Date.parse(e.at) > clearedAt);
  const pending = holds.filter(h => h.status === "pending");
  const counterparties = [...new Map(visible.filter(d => d.payee).map(d => [d.payee!.address, d.payee!])).values()]
    .filter(p => !profile || p.address.toLowerCase() !== profile.address.toLowerCase());

  return (
    <div>
      {wallets.length > 0 && (
        <div className="mb-8 flex flex-col gap-3 sm:flex-row">
          {wallets.map(w => <WalletCard key={w.key} status={w} />)}
        </div>
      )}

      <p className="mb-3 text-sm text-muted-foreground">Ask the agent to buy something. Each click is one purchase attempt.</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {actions.map(a => (
          <Button
            key={a.title}
            disabled={busy}
            variant={a.primary ? "default" : "outline"}
            className="h-auto flex-col items-start gap-0.5 py-2.5 text-left whitespace-normal"
            onClick={() => post("/pay", a.body)}
          >
            <span>{a.title}</span>
            <span className="text-xs font-normal opacity-75">{a.detail}</span>
          </Button>
        ))}
      </div>
      {busy && <p className="mt-3 text-sm text-muted-foreground">Screening with Intercepta and settling…</p>}
      {error && (
        <p role="alert" className="mt-4 rounded-md border border-void/30 bg-void/5 px-3 py-2 text-sm text-void">
          {error}
        </p>
      )}

      <Section title="Waiting for you" blurb="Payments the agent paused for your approval, for example because the amount is above your 0.25 USDC threshold.">
        {pending.length === 0 && <p className="text-muted-foreground">Nothing waiting for you.</p>}
        {pending.map(h => (
          <Entry key={h.id} className="border-intaglio/40">
            <p className="flex flex-wrap items-center gap-2">
              <Stamp label="Waiting for you" tone="wait" /> {usdc(h.amount)} → <code className="font-mono text-sm">{short(h.payTo)}</code>
            </p>
            <Reasons reasons={h.reasons} />
            <div className="mt-3 flex gap-2">
              <Button size="sm" disabled={busy} onClick={() => post(`/holds/${h.id}/approve`)}>Approve</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => post(`/holds/${h.id}/reject`)}>Reject</Button>
            </div>
          </Entry>
        ))}
      </Section>

      <Section
        title="Payment feed"
        blurb="Every purchase attempt, newest first: what happened and why. Reasons come from Intercepta's screening and your wallet's limits."
        action={visible.length > 0 || visibleLog.length > 0 ? <Button size="sm" variant="ghost" onClick={clearFeed}>Clear feed</Button> : undefined}
      >
        {visible.length === 0 && <p className="text-muted-foreground">No payments yet.</p>}
        {visible.map(d => {
          const outcome = outcomes[d.status] ?? { label: d.status, tone: "muted" as Tone };
          return (
            <Entry key={d.id}>
              <p className="flex flex-wrap items-center gap-2">
                <Stamp label={d.status === "settled" && d.verdict?.kind === "CAP" ? "Paid (capped)" : outcome.label} tone={outcome.tone} />
                {usdc(d.amount)} → <code className="font-mono text-sm">{short(d.payTo)}</code>
                <span className="text-sm text-muted-foreground">
                  {pathOf(d.url)}
                  {d.verdict && ` · agent said ${d.verdict.kind}`}
                </span>
              </p>
              {d.verdict && <Reasons reasons={d.verdict.reasons} />}
              {d.status === "unsettled" && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Your budget is already reserved for this payment, and the seller can still collect it
                  {d.validBefore ? ` until ${new Date(Number(d.validBefore) * 1000).toLocaleTimeString()}` : ""}.
                </p>
              )}
              {d.error && (d.status === "rejected_by_payee" ? <SellerRefusal error={d.error} /> : <p className="mt-2 text-sm text-void">{d.error}</p>)}
              {d.settleTx && (
                <a
                  className="mt-2 inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
                  href={`${EXPLORER}${d.settleTx}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  settlement tx <ExternalLink className="size-3.5" />
                </a>
              )}
            </Entry>
          );
        })}
      </Section>

      <Section title="Seller's side" blurb="Before accepting money, the seller screens the paying wallet, its owner and its agent with Intercepta.">
        {visibleLog.length === 0 && <p className="text-muted-foreground">The seller hasn't screened a payer yet.</p>}
        {visibleLog.map((e, i) => (
          <Entry key={i}>
            <p className="flex flex-wrap items-center gap-2">
              <Stamp label={e.outcome === "accepted" ? "Accepted" : "Refused"} tone={e.outcome === "accepted" ? "go" : "stop"} />
              payer <code className="font-mono text-sm">{short(e.payer)}</code>
            </p>
            {e.reasons.length > 0 && <Reasons reasons={e.reasons} />}
          </Entry>
        ))}
      </Section>

      <Section title="Counterparties" blurb="Risk profiles from Intercepta for everyone the agent dealt with. Paste any address to screen it.">
        <form className="flex max-w-xl flex-col gap-2 sm:flex-row sm:items-end" onSubmit={e => { e.preventDefault(); screen(); }}>
          <div className="flex-1 space-y-2">
            <Label htmlFor="lookup">Screen any address</Label>
            <Input id="lookup" value={lookup} onChange={e => setLookup(e.target.value)} placeholder="0x…" className="font-mono" />
          </div>
          <Button type="submit" variant="secondary">Get risk profile</Button>
        </form>
        {[...(profile ? [profile] : []), ...counterparties].map(p => (
          <Entry key={p.address}>
            <p className="flex flex-wrap items-center gap-2">
              <Stamp label={p.tier} tone={tierTone[p.tier]} /> <code className="font-mono text-sm break-all">{p.address}</code>
              {p.labels.length > 0 && <span className="text-sm text-muted-foreground">{p.labels.join(" · ")}</span>}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">screened {new Date(p.screenedAt).toLocaleString()}</p>
            {p.reasons.length ? <Reasons reasons={p.reasons} /> : <p className="mt-2 text-sm text-muted-foreground">No risk traits.</p>}
          </Entry>
        ))}
      </Section>
    </div>
  );
}
