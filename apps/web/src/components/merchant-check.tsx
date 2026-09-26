import { AnimatePresence, motion } from "motion/react";
import type { ScreeningResponse, ScreeningStatus } from "@/lib/screening";
import { shortAddress, time } from "@/lib/format";
import { cn } from "@/lib/utils";

const verdicts: Record<ScreeningStatus, { stamp: string; title: string; body: string; tone: string }> = {
  trusted: {
    stamp: "Verified",
    title: "No risk found",
    body: "Intercepta found no scam, sanctions or stolen-funds history for this address.",
    tone: "text-banknote border-banknote",
  },
  caution: {
    stamp: "Caution",
    title: "Some risk found",
    body: "This address has risk signals. Issue a card only if you trust this merchant.",
    tone: "text-intaglio border-intaglio",
  },
  blocked: {
    stamp: "Blocked",
    title: "Don't pay this merchant",
    body: "Intercepta flags this address for scams, sanctions or stolen funds. Cards can't be issued to it.",
    tone: "text-void border-void",
  },
  unverified: {
    stamp: "Unverified",
    title: "Couldn't check this merchant",
    body: "The check didn't return a usable answer, so nothing is known about this address.",
    tone: "text-ink/70 border-ink/60",
  },
};

export function MerchantCheck({
  address,
  name,
  result,
  pending,
}: {
  address: string;
  name?: string;
  result?: ScreeningResponse;
  pending: boolean;
}) {
  const verdict = result ? verdicts[result.status] : undefined;

  return (
    <section aria-live="polite" className="relative overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex items-baseline justify-between border-b border-border/80 px-5 py-3">
        <h3 className="text-sm font-semibold">Merchant check</h3>
        <span className="text-xs text-muted-foreground">by Intercepta</span>
      </header>

      <div className="px-5 py-4">
        <p className="font-display text-2xl leading-tight">{name ?? "Another merchant"}</p>
        <p className="mt-1 font-mono text-xs break-all text-muted-foreground">{address}</p>

        <div className="relative mt-4 min-h-[9.5rem]">
          <AnimatePresence mode="wait" initial={false}>
            {pending || !verdict || !result ? (
              <motion.div key="scanning" exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                <ScanBand />
                <p className="mt-3 text-sm text-muted-foreground">
                  Checking {name ?? shortAddress(address)} for scams, sanctions and stolen funds…
                </p>
              </motion.div>
            ) : (
              <motion.div key="result" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
                <div className="flex flex-col items-start gap-3">
                  <motion.span
                    initial={{ opacity: 0, scale: 1.6, rotate: -14 }}
                    animate={{ opacity: 0.9, scale: 1, rotate: -8 }}
                    transition={{ type: "spring", stiffness: 520, damping: 26 }}
                    className={cn(
                      "font-display shrink-0 rounded-sm border-[3px] border-double px-2.5 pt-1 text-xl uppercase tracking-[0.16em]",
                      verdict.tone,
                    )}
                  >
                    {verdict.stamp}
                  </motion.span>
                  <div>
                    <p className="font-semibold">{verdict.title}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{result.detail ?? verdict.body}</p>
                  </div>
                </div>

                {result.reasons.length > 0 && (
                  <ul className="mt-4 space-y-1.5 text-sm">
                    {result.reasons.slice(0, 4).map(reason => (
                      <li key={reason.code} className="flex gap-2">
                        <span aria-hidden="true" className={cn("mt-2 size-1.5 shrink-0 rounded-full bg-current", verdict.tone)} />
                        <span>{reason.detail}</span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {result.toxicScore !== undefined && (
                    <span className="rounded-full bg-paper-deep px-2 py-0.5">Risk score {result.toxicScore} of 100</span>
                  )}
                  {result.labels.map(label => (
                    <span key={label} className="rounded-full bg-paper-deep px-2 py-0.5">
                      {label}
                    </span>
                  ))}
                  <span>Checked at {time(Date.parse(result.screenedAt) / 1000)}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}

function ScanBand() {
  return (
    <div className="relative h-16 overflow-hidden rounded-lg bg-paper-deep" aria-hidden="true">
      <svg viewBox="0 0 400 64" preserveAspectRatio="none" className="absolute inset-0 size-full text-intaglio/40">
        {Array.from({ length: 7 }, (_, i) => (
          <path
            key={i}
            d={`M0 ${14 + i * 6} ${Array.from({ length: 21 }, (_, x) => `L${x * 20} ${14 + i * 6 + 6 * Math.sin(x * 0.9 + i * 0.5)}`).join(" ")}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="0.8"
          />
        ))}
      </svg>
      <motion.div
        className="absolute inset-y-0 w-1/4 bg-gradient-to-r from-transparent via-intaglio/25 to-transparent"
        initial={{ left: "-25%" }}
        animate={{ left: "100%" }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}
