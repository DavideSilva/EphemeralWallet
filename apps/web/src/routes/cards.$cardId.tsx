import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { ActivityList } from "@/components/activity-list";
import { WithSnapshot } from "@/components/chain-state";
import { CommandBox } from "@/components/command-box";
import { Meter } from "@/components/meter";
import { SecurityCard } from "@/components/security-card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cancelCard, reclaimCard } from "@/lib/actions";
import type { Card, Snapshot } from "@/lib/data";
import { agentCommand, eth, time, validity } from "@/lib/format";
import { savedGoal, saveGoal } from "@/lib/goals";
import { useMerchant } from "@/lib/hooks";

export const Route = createFileRoute("/cards/$cardId")({ component: CardPage });

function CardPage() {
  const { cardId } = Route.useParams();
  return (
    <div>
      <Link to="/cards" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All cards
      </Link>
      <div className="mt-6">
        <WithSnapshot>
          {snapshot => {
            const card = snapshot.cards.find(c => c.id === cardId.toLowerCase());
            if (!card) {
              return (
                <div className="max-w-md">
                  <h1 className="font-display text-4xl">Card not found</h1>
                  <p className="mt-3 text-muted-foreground">
                    No card with this number belongs to your wallet on this chain. If you restarted the demo, the chain
                    was reset and old cards are gone.
                  </p>
                </div>
              );
            }
            return <CardDetail card={card} snapshot={snapshot} />;
          }}
        </WithSnapshot>
      </div>
    </div>
  );
}

function CardDetail({ card, snapshot }: { card: Card; snapshot: Snapshot }) {
  const merchant = useMerchant(card.merchant);
  const activity = snapshot.activity.filter(a => a.cardId === card.id);

  return (
    <div className="space-y-14">
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <SecurityCard card={card} size="lg" />
          <Limits card={card} />
        </div>

        <div className="space-y-8">
          <div>
            <h1 className="font-display text-4xl">{merchant?.name ?? "Card"}</h1>
            <p className="mt-2 text-muted-foreground">
              {card.kind === "one-time"
                ? "A one-time card with its own wallet. After one purchase it's used up, and the rest can come back to you."
                : "A multi-use card that draws from your account. Its agent can keep buying until a limit runs out."}
            </p>
          </div>

          {card.status === "active" ? <TaskComposer card={card} /> : <Inactive card={card} />}
          <Catalog merchant={card.merchant} />
          <Controls card={card} />
        </div>
      </div>

      <section className="max-w-3xl">
        <h2 className="mb-3 text-xl font-semibold">Activity on this card</h2>
        {activity.length === 0 ? (
          <p className="text-muted-foreground">Nothing yet. Run the command above and the agent's purchase will appear here.</p>
        ) : (
          <ActivityList activity={activity} cards={snapshot.cards} showCard={false} />
        )}
      </section>
    </div>
  );
}

function Limits({ card }: { card: Card }) {
  const total = Math.max(1, card.expiresAt - card.issuedAt);
  const elapsed = Math.min(total, Math.max(0, Date.now() / 1000 - card.issuedAt));
  return (
    <div className="grid gap-5 rounded-xl border border-border bg-card p-5 sm:grid-cols-3">
      <Meter label={`${eth(card.spent)} of ${eth(card.maxSpend)} ETH spent`} value={Number(card.spent)} max={Number(card.maxSpend)} />
      <Meter label={`${card.uses} of ${card.maxUses} ${card.maxUses === 1 ? "use" : "uses"}`} value={card.uses} max={card.maxUses} />
      <Meter label={validity(card.expiresAt)} value={elapsed} max={total} tone="intaglio" />
    </div>
  );
}

function TaskComposer({ card }: { card: Card }) {
  const [goal, setGoal] = useState(() => savedGoal(card.id));
  return (
    <div className="space-y-3">
      <Label htmlFor="goal" className="text-base font-semibold">
        Give the agent a task
      </Label>
      <Textarea
        id="goal"
        value={goal}
        rows={2}
        placeholder="Buy two cinema tickets for tonight"
        onChange={e => {
          setGoal(e.target.value);
          saveGoal(card.id, e.target.value);
        }}
        className="bg-card text-base"
      />
      <p className="text-sm text-muted-foreground">Run this in a terminal at the project root. The agent plans the purchase and the card enforces the limits.</p>
      <CommandBox command={agentCommand(card.id, goal)} />
    </div>
  );
}

function Inactive({ card }: { card: Card }) {
  const message = {
    used: card.kind === "one-time" ? "This card made its one purchase and can't be used again." : "Every use on this card is spent.",
    expired: `This card expired at ${time(card.expiresAt)}. The agent can no longer use it.`,
    cancelled: "You cancelled this card. The agent can no longer use it.",
    active: "",
  }[card.status];
  return <p className="rounded-xl bg-paper-deep p-4 text-sm">{message}</p>;
}

function Catalog({ merchant: address }: { merchant: string }) {
  const merchant = useMerchant(address);
  if (!merchant) return null;
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold">What {merchant.name} sells</h2>
      <ul className="divide-y divide-border/80 border-y border-border/80 text-sm">
        {merchant.items.map(item => (
          <li key={item.name} className="flex justify-between py-2">
            <span>{item.name}</span>
            <span className="text-muted-foreground">{eth(item.price)} ETH</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Controls({ card }: { card: Card }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["snapshot"] });
  const cancel = useMutation({
    mutationFn: () => cancelCard(card),
    onSuccess: () => {
      toast.success("Card cancelled");
      return refresh();
    },
    onError: error => toast.error(error.message.split("\n")[0]),
  });
  const reclaim = useMutation({
    mutationFn: () => reclaimCard(card),
    onSuccess: () => {
      toast.success(`Returned ${eth(card.balance)} ETH to your wallet`);
      return refresh();
    },
    onError: error => toast.error(error.message.split("\n")[0]),
  });

  const canReclaim = card.kind === "one-time" && card.status !== "active" && card.balance > 0n;
  if (card.status !== "active" && !canReclaim) return null;

  return (
    <div className="flex flex-wrap gap-3">
      {canReclaim && (
        <Button variant="outline" onClick={() => reclaim.mutate()} disabled={reclaim.isPending}>
          {reclaim.isPending ? "Returning…" : `Return ${eth(card.balance)} ETH to me`}
        </Button>
      )}
      {card.status === "active" && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="border-void/40 text-void hover:bg-void/5 hover:text-void" disabled={cancel.isPending}>
              {cancel.isPending ? "Cancelling…" : "Cancel card"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel this card?</AlertDialogTitle>
              <AlertDialogDescription>
                The agent loses access immediately and the card can't be reactivated.
                {card.kind === "one-time" && ` The ${eth(card.balance)} ETH on it comes back to your wallet.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep card</AlertDialogCancel>
              <AlertDialogAction onClick={() => cancel.mutate()} className="bg-void text-white hover:bg-void/90">
                Cancel card
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
