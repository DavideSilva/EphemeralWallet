import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { motion } from "motion/react";
import { toast } from "sonner";
import { parseEther } from "viem";
import { ActivityList } from "@/components/activity-list";
import { EmptyCards, WithSnapshot } from "@/components/chain-state";
import { SecurityCard } from "@/components/security-card";
import { Button } from "@/components/ui/button";
import { topUp } from "@/lib/actions";
import type { Snapshot } from "@/lib/data";
import { eth } from "@/lib/format";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <WithSnapshot>{snapshot => <Overview snapshot={snapshot} />}</WithSnapshot>;
}

function Overview({ snapshot }: { snapshot: Snapshot }) {
  const { cards, activity, account } = snapshot;
  const active = cards.filter(c => c.status === "active");
  const shown = active.length ? active : cards.slice(0, 3);

  return (
    <div className="space-y-14">
      <section>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-4xl sm:text-5xl">Your cards</h1>
            <p className="mt-2 text-muted-foreground">
              {active.length === 0
                ? "No card is active right now."
                : active.length === 1
                  ? "One card is active. Its agent can spend within the limits printed on it."
                  : `${active.length} cards are active. Each agent can spend only within the limits printed on its card.`}
            </p>
          </div>
          <AccountPanel account={account} />
        </div>

        {cards.length === 0 ? (
          <EmptyCards />
        ) : (
          <>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {shown.slice(0, 6).map((card, i) => (
                <motion.div
                  key={card.id}
                  initial={{ opacity: 0, y: 14, rotate: -1.5 }}
                  animate={{ opacity: 1, y: 0, rotate: 0 }}
                  transition={{ delay: i * 0.07, duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
                >
                  <SecurityCard card={card} link />
                </motion.div>
              ))}
            </div>
            {cards.length > shown.slice(0, 6).length && (
              <Link to="/cards" className="mt-4 inline-block text-sm font-medium text-intaglio hover:underline">
                See all {cards.length} cards
              </Link>
            )}
          </>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold">Recent activity</h2>
          {activity.length > 0 && (
            <Link to="/activity" className="text-sm font-medium text-intaglio hover:underline">
              See all activity
            </Link>
          )}
        </div>
        {activity.length === 0 ? (
          <p className="text-muted-foreground">Purchases and blocked attempts show up here as agents use their cards.</p>
        ) : (
          <ActivityList activity={activity.slice(0, 6)} cards={cards} />
        )}
      </section>
    </div>
  );
}

function AccountPanel({ account }: { account: Snapshot["account"] }) {
  const [busy, setBusy] = useState(false);
  if (!account) return null;

  async function addFunds() {
    setBusy(true);
    try {
      await topUp(account!.address, parseEther("0.01"));
      toast.success("Added 0.01 ETH to your account");
    } catch (error) {
      toast.error(error instanceof Error ? error.message.split("\n")[0] : "Couldn't add funds");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-3">
      <div>
        <div className="text-xs text-muted-foreground">Account for multi-use cards</div>
        <div className="font-display text-2xl">{eth(account.balance)} ETH</div>
      </div>
      <Button size="sm" variant="outline" onClick={addFunds} disabled={busy}>
        {busy ? "Adding…" : "Add 0.01 ETH"}
      </Button>
    </div>
  );
}
