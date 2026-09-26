import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { zeroAddress, type Address } from "viem";
import { Button } from "@/components/ui/button";
import { SecurityCard, type CardFace } from "@/components/security-card";
import { useMerchants, useSnapshot } from "@/lib/hooks";
import type { Snapshot } from "@/lib/data";

export function WithSnapshot({ children }: { children: (snapshot: Snapshot) => ReactNode }) {
  const { data, error, isPending } = useSnapshot();
  if (error && !data) {
    return (
      <div className="max-w-lg rounded-xl border border-void/30 bg-void/5 p-6">
        <h2 className="font-semibold text-void">Can't reach the local chain</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The app reads cards from Anvil at 127.0.0.1:8545. Start everything with <code className="font-mono">npm run demo</code>, then
          reload this page.
        </p>
        <p className="mt-3 font-mono text-xs break-all text-muted-foreground">{error.message.split("\n")[0]}</p>
      </div>
    );
  }
  if (isPending || !data) return <Loading />;
  return <>{children(data)}</>;
}

function Loading() {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" aria-busy="true" aria-label="Loading cards">
      {[0, 1, 2].map(i => (
        <div key={i} className="aspect-[1.586] animate-pulse rounded-[14px] bg-paper-deep" />
      ))}
    </div>
  );
}

const hour = () => Date.now() / 1000 + 3600;
const samples = (merchants: Address[]): CardFace[] => [
  { id: "sample-a", kind: "multi-use", merchant: merchants[1] ?? zeroAddress, maxSpend: 10n ** 16n, spent: 4n * 10n ** 15n, maxUses: 3, uses: 2, expiresAt: hour(), status: "active" },
  { id: "sample-b", kind: "one-time", merchant: merchants[0] ?? zeroAddress, maxSpend: 2n * 10n ** 15n, spent: 0n, maxUses: 1, uses: 0, expiresAt: hour(), status: "active" },
];

export function EmptyCards() {
  const { data: merchants } = useMerchants();
  const faces = samples((merchants ?? []).map(m => m.address));
  return (
    <div className="grid items-center gap-10 overflow-hidden rounded-2xl border border-dashed border-input p-8 sm:p-12 lg:grid-cols-[1fr_minmax(0,26rem)]">
      <div>
        <h2 className="font-display text-3xl sm:text-4xl">Give an agent a card, not your wallet.</h2>
        <p className="mt-3 max-w-xl text-muted-foreground">
          A card lets one agent spend at one merchant, up to a budget, for a limited time. Use it once, or let it work
          until the limits run out. Cancel it whenever you like.
        </p>
        <Button asChild className="mt-6">
          <Link to="/cards/new">Issue your first card</Link>
        </Button>
      </div>
      <div className="relative mx-auto hidden h-64 w-full max-w-sm sm:block" aria-hidden="true">
        {faces.map((face, i) => (
          <motion.div
            key={face.id}
            className="absolute inset-x-0 top-0"
            initial={{ opacity: 0, y: 20, rotate: 0 }}
            animate={{ opacity: 1, y: i * 44, x: i * 18, rotate: i === 0 ? -6 : 3 }}
            transition={{ delay: 0.15 + i * 0.12, duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <SecurityCard card={face} />
          </motion.div>
        ))}
      </div>
    </div>
  );
}
