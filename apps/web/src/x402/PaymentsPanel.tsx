import { useEffect, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const AGENT = import.meta.env.VITE_AGENT_URL ?? "http://localhost:4100";
const SERVICE = import.meta.env.VITE_SERVICE_URL ?? "http://localhost:4021";
const EXPLORER = "https://sepolia.basescan.org/tx/";

type Reason = { source: string; code: string; detail: string };
type Profile = { address: string; tier: "TRUSTED" | "CAUTION" | "BLOCKED"; toxicScore: number; reasons: Reason[]; labels: string[]; screenedAt: string };
type Decision = {
  id: string; createdAt: string; url: string; wallet: string; payTo?: string; amount?: string; status: string;
  verdict?: { kind: string; reasons: Reason[]; cap?: string }; payee?: Profile; approveTx?: string; settleTx?: string; error?: string;
};
type Hold = { id: string; url: string; payTo: string; amount: string; reasons: Reason[]; status: string };
type PayerLogEntry = { at: string; payer: string; outcome: string; reasons: Reason[] };

const usdc = (amount?: string) => (amount ? `${Number(amount) / 1e6} USDC` : "");
const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

// Verdicts and tiers share the card-stamp look: green for go, violet for caution, red for stop.
const tone: Record<string, string> = {
  PAY: "border-banknote text-banknote",
  TRUSTED: "border-banknote text-banknote",
  CAP: "border-intaglio text-intaglio",
  HOLD: "border-intaglio text-intaglio",
  CAUTION: "border-intaglio text-intaglio",
  REFUSE: "border-void text-void",
  BLOCKED: "border-void text-void",
  ERROR: "border-void text-void",
};

function Badge({ kind, toneOf = kind }: { kind: string; toneOf?: string }) {
  return (
    <span
      className={cn(
        "inline-block -rotate-2 rounded-sm border-2 border-double px-2 pt-0.5 font-display text-sm uppercase tracking-[0.16em]",
        tone[toneOf] ?? "border-ink/60 text-ink/70",
      )}
    >
      {kind}
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl sm:text-3xl">{title}</h2>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

export function PaymentsPanel() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [holds, setHolds] = useState<Hold[]>([]);
  const [payerLog, setPayerLog] = useState<PayerLogEntry[]>([]);
  const [lookup, setLookup] = useState("");
  const [profile, setProfile] = useState<Profile>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function refresh() {
    const [d, h, p] = await Promise.all([
      fetch(`${AGENT}/decisions`).then(r => r.json()),
      fetch(`${AGENT}/holds`).then(r => r.json()),
      fetch(`${SERVICE}/decisions`).then(r => r.json()).catch(() => []),
    ]);
    setDecisions(d); setHolds(h); setPayerLog(p);
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

  const pending = holds.filter(h => h.status === "pending");
  const counterparties = [...new Map(decisions.filter(d => d.payee).map(d => [d.payee!.address, d.payee!])).values()]
    .filter(p => !profile || p.address.toLowerCase() !== profile.address.toLowerCase());

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => post("/pay", { url: `${SERVICE}/dataset` })}>Pay /dataset (0.01)</Button>
        <Button disabled={busy} variant="outline" onClick={() => post("/pay", { url: `${SERVICE}/premium-dataset` })}>
          Pay /premium-dataset (risky payee)
        </Button>
        <Button disabled={busy} variant="outline" onClick={() => post("/pay", { url: `${SERVICE}/bulk-dataset` })}>
          Pay /bulk-dataset (0.30)
        </Button>
        <Button disabled={busy} variant="outline" onClick={() => post("/pay", { url: `${SERVICE}/dataset`, wallet: "risky" })}>
          Pay /dataset as risky wallet
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-4 rounded-md border border-void/30 bg-void/5 px-3 py-2 text-sm text-void">
          {error}
        </p>
      )}

      <Section title="Held payments">
        {pending.length === 0 && <p className="text-muted-foreground">Nothing waiting for you.</p>}
        {pending.map(h => (
          <Entry key={h.id} className="border-intaglio/40">
            <p className="flex flex-wrap items-center gap-2">
              <Badge kind="HOLD" /> {usdc(h.amount)} → <code className="font-mono text-sm">{short(h.payTo)}</code>
            </p>
            <Reasons reasons={h.reasons} />
            <div className="mt-3 flex gap-2">
              <Button size="sm" disabled={busy} onClick={() => post(`/holds/${h.id}/approve`)}>Approve</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => post(`/holds/${h.id}/reject`)}>Reject</Button>
            </div>
          </Entry>
        ))}
      </Section>

      <Section title="Payment feed">
        {decisions.length === 0 && <p className="text-muted-foreground">No payments yet.</p>}
        {decisions.map(d => (
          <Entry key={d.id}>
            <p className="flex flex-wrap items-center gap-2">
              <Badge kind={d.verdict?.kind ?? "ERROR"} /> {usdc(d.amount)} → <code className="font-mono text-sm">{short(d.payTo)}</code>
              <span className="text-sm text-muted-foreground">{new URL(d.url).pathname} · {d.status}</span>
            </p>
            {d.verdict && <Reasons reasons={d.verdict.reasons} />}
            {d.error && <p className="mt-2 text-sm text-void">{d.error}</p>}
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
        ))}
      </Section>

      <Section title="Service: payer screening">
        {payerLog.length === 0 && <p className="text-muted-foreground">The service hasn't screened a payer yet.</p>}
        {payerLog.map((e, i) => (
          <Entry key={i}>
            <p className="flex flex-wrap items-center gap-2">
              <Badge kind={e.outcome.toUpperCase()} toneOf={e.outcome === "accepted" ? "PAY" : "REFUSE"} /> payer <code className="font-mono text-sm">{short(e.payer)}</code>
            </p>
            <Reasons reasons={e.reasons} />
          </Entry>
        ))}
      </Section>

      <Section title="Counterparties">
        <form
          className="flex max-w-xl flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={e => { e.preventDefault(); screen(); }}
        >
          <div className="flex-1 space-y-2">
            <Label htmlFor="lookup">Screen any address</Label>
            <Input id="lookup" value={lookup} onChange={e => setLookup(e.target.value)} placeholder="0x…" className="font-mono" />
          </div>
          <Button type="submit" variant="secondary">Get risk profile</Button>
        </form>
        {[...(profile ? [profile] : []), ...counterparties].map(p => (
          <Entry key={p.address}>
            <p className="flex flex-wrap items-center gap-2">
              <Badge kind={p.tier} /> <code className="font-mono text-sm break-all">{p.address}</code>
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
