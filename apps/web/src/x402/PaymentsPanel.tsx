import React, { useEffect, useState } from "react";

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

function Reasons({ reasons }: { reasons: Reason[] }) {
  return <ul className="reasons">{reasons.map((r, i) => <li key={i}><span className="code">{r.code}</span> {r.detail}</li>)}</ul>;
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
      fetch(`${SERVICE}/decisions`).then(r => r.json()).catch(() => [])
    ]);
    setDecisions(d); setHolds(h); setPayerLog(p);
  }
  useEffect(() => { refresh().catch(() => {}); const t = setInterval(() => refresh().catch(() => {}), 2000); return () => clearInterval(t); }, []);

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

  const counterparties = [...new Map(decisions.filter(d => d.payee).map(d => [d.payee!.address, d.payee!])).values()]
    .filter(p => !profile || p.address.toLowerCase() !== profile.address.toLowerCase());

  return <section className="x402">
    <div className="actions">
      <button disabled={busy} onClick={() => post("/pay", { url: `${SERVICE}/dataset` })}>Pay /dataset (0.01)</button>
      <button disabled={busy} onClick={() => post("/pay", { url: `${SERVICE}/premium-dataset` })}>Pay /premium-dataset (risky payee)</button>
      <button disabled={busy} onClick={() => post("/pay", { url: `${SERVICE}/bulk-dataset` })}>Pay /bulk-dataset (0.30)</button>
      <button disabled={busy} onClick={() => post("/pay", { url: `${SERVICE}/dataset`, wallet: "risky" })}>Pay /dataset as risky wallet</button>
    </div>
    {error && <p className="error">{error}</p>}

    <h2>Held payments</h2>
    {holds.filter(h => h.status === "pending").length === 0 && <p className="muted">Nothing waiting for you.</p>}
    {holds.filter(h => h.status === "pending").map(h => <div key={h.id} className="card hold">
      <p><span className="badge HOLD">HOLD</span> {usdc(h.amount)} → <code>{short(h.payTo)}</code></p>
      <Reasons reasons={h.reasons}/>
      <button disabled={busy} onClick={() => post(`/holds/${h.id}/approve`)}>Approve</button>
      <button disabled={busy} className="secondary" onClick={() => post(`/holds/${h.id}/reject`)}>Reject</button>
    </div>)}

    <h2>Payment feed</h2>
    {decisions.map(d => <div key={d.id} className="card">
      <p><span className={`badge ${d.verdict?.kind ?? "FAILED"}`}>{d.verdict?.kind ?? "ERROR"}</span> {usdc(d.amount)} → <code>{short(d.payTo)}</code> <span className="muted">{new URL(d.url).pathname} · {d.status}</span></p>
      {d.verdict && <Reasons reasons={d.verdict.reasons}/>}
      {d.error && <p className="error">{d.error}</p>}
      {d.settleTx && <a href={`${EXPLORER}${d.settleTx}`} target="_blank" rel="noopener noreferrer">settlement tx</a>}
    </div>)}

    <h2>Service: payer screening</h2>
    {payerLog.map((e, i) => <div key={i} className="card">
      <p><span className={`badge ${e.outcome === "accepted" ? "PAY" : "REFUSE"}`}>{e.outcome.toUpperCase()}</span> payer <code>{short(e.payer)}</code></p>
      <Reasons reasons={e.reasons}/>
    </div>)}

    <h2>Counterparties</h2>
    <label>Screen any address<input value={lookup} onChange={e => setLookup(e.target.value)} placeholder="0x…"/></label>
    <button onClick={screen}>Get risk profile</button>
    {[...(profile ? [profile] : []), ...counterparties].map(p => <div key={p.address} className="card">
      <p><span className={`badge ${p.tier}`}>{p.tier}</span> <code>{p.address}</code> {p.labels.join(" · ")}</p>
      <p className="muted">screened {new Date(p.screenedAt).toLocaleString()}</p>
      {p.reasons.length ? <Reasons reasons={p.reasons}/> : <p className="muted">No risk traits.</p>}
    </div>)}
  </section>;
}
