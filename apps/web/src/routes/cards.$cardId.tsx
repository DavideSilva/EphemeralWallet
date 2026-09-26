import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Hourglass } from "lucide-react";
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
import { approvalChallenge, approvePurchase, approveWithPasskey, cancelCard, reclaimCard } from "@/lib/actions";
import { describePurchase, type Activity, type Card, type Held, type Snapshot } from "@/lib/data";
import { agentCommand, eth, shortAddress, time, validity } from "@/lib/format";
import { savedGoal, saveGoal } from "@/lib/goals";
import { useMerchant, useMerchants } from "@/lib/hooks";
import { storedPasskey } from "@/lib/passkey";
import { savedScreening, type ScreeningStatus } from "@/lib/screening";

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
        <div className="max-w-2xl space-y-6">
          <SecurityCard card={card} size="lg" />
          <Limits card={card} />
        </div>

        <div className="space-y-8">
          <div>
            <h1 className="font-display text-4xl">{merchant?.name ?? shortAddress(card.merchant)}</h1>
            <p className="mt-2 text-muted-foreground">
              {card.kind === "one-time"
                ? "A one-time card with its own wallet. After one purchase it's used up, and the rest can come back to you."
                : "A multi-use card that draws from your account. Its agent can keep buying until a limit runs out."}
            </p>
          </div>

          <IssueCheck cardId={card.id} />
          {card.status === "active" && <ApprovalRequests card={card} activity={activity} />}
          {card.status === "active" ? <TaskComposer card={card} /> : <Inactive card={card} />}
          <Catalog merchant={card.merchant} />
          <Controls card={card} />
        </div>
      </div>

      <section className="max-w-5xl">
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

const checkLabels: Record<ScreeningStatus, { text: string; tone: string }> = {
  trusted: { text: "Verified: no scam, sanctions or stolen-funds history", tone: "text-banknote" },
  caution: { text: "Caution: risk signals found, issued anyway", tone: "text-intaglio" },
  blocked: { text: "Blocked merchant", tone: "text-void" },
  unverified: { text: "Unverified: the check couldn't run, issued anyway", tone: "text-muted-foreground" },
};

function IssueCheck({ cardId }: { cardId: string }) {
  const [check] = useState(() => savedScreening(cardId));
  if (!check) return null;
  const label = checkLabels[check.status];
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
      <span className="font-semibold">Merchant check at issue</span>
      <span className={label.tone}>{label.text}</span>
      <span className="text-muted-foreground">(Intercepta, {time(Date.parse(check.screenedAt) / 1000)})</span>
    </p>
  );
}

function Limits({ card }: { card: Card }) {
  const total = Math.max(1, card.expiresAt - card.issuedAt);
  const elapsed = Math.min(total, Math.max(0, Date.now() / 1000 - card.issuedAt));
  return (
    <div className="space-y-3">
      <div className="grid gap-5 rounded-xl border border-border bg-card p-5 sm:grid-cols-3">
        <Meter label={`${eth(card.spent)} of ${eth(card.maxSpend)} ETH spent`} value={Number(card.spent)} max={Number(card.maxSpend)} />
        <Meter label={`${card.uses} of ${card.maxUses} ${card.maxUses === 1 ? "use" : "uses"}`} value={card.uses} max={card.maxUses} />
        <Meter
          label={card.status === "active" || card.status === "expired" ? validity(card.expiresAt) : "No longer usable"}
          value={card.status === "active" ? elapsed : total}
          max={total}
          tone="intaglio"
        />
      </div>
      {card.approvalThreshold !== undefined && (
        <p className="text-sm text-muted-foreground">
          Any purchase over {eth(card.approvalThreshold)} ETH waits until you approve that exact purchase
          {card.approvalBy === "passkey" ? " with Touch ID." : "."}
        </p>
      )}
    </div>
  );
}

/** Held purchases still waiting for the owner. The newest row per request decides its state. */
function pendingApprovals(activity: Activity[]): (Activity & { held: Held })[] {
  const latest = new Map<string, Activity & { held: Held }>();
  for (const item of activity) {
    if (item.held && !latest.has(item.held.requestKey)) latest.set(item.held.requestKey, item as Activity & { held: Held });
  }
  return [...latest.values()].filter(item => item.held.state === "waiting");
}

function ApprovalRequests({ card, activity }: { card: Card; activity: Activity[] }) {
  const pending = pendingApprovals(activity);
  if (pending.length === 0) return null;
  return (
    <div className="space-y-3">
      {pending.map(item => (
        <ApprovalRequest key={item.id} attempt={item.id} held={item.held} card={card} />
      ))}
    </div>
  );
}

function ApprovalRequest({ attempt, held, card }: { attempt: string; held: Held; card: Card }) {
  const queryClient = useQueryClient();
  const passkey = card.approvalBy === "passkey";
  const stored = passkey ? storedPasskey() : null;
  const wrongPasskey = passkey && stored?.publicKey.toLowerCase() !== card.approvalPublicKey?.toLowerCase();
  // Read ahead so the click goes straight to Touch ID (Safari only allows the prompt right after a click), and
  // refreshed every few minutes so the signed expiry never goes stale while the page stays open.
  const challenge = useQuery({
    // Per held attempt: the same purchase held again after an approval has a new nonce, so a new challenge.
    queryKey: ["approval-challenge", attempt],
    queryFn: () => approvalChallenge(held),
    enabled: passkey && !wrongPasskey,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
  const { data: merchants } = useMerchants();
  const merchant = merchants?.find(m => m.address.toLowerCase() === held.target.toLowerCase());
  // Decoded from the calldata the agent sent, never from its memo, so the owner approves what will actually run.
  const purchase = merchants ? describePurchase(merchants, held.target, held.data) : undefined;
  const approve = useMutation({
    mutationFn: () => (passkey ? approveWithPasskey(held, challenge.data!) : approvePurchase(held)),
    onSuccess: () => {
      toast.success("Approved. The agent will retry now.");
      return queryClient.invalidateQueries({ queryKey: ["snapshot"] });
    },
    onError: error => toast.error(error.message.split("\n")[0]),
  });
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4" role="alert">
      <p className="flex items-center gap-2 font-semibold text-amber-900">
        <Hourglass className="size-4" aria-hidden="true" /> Your agent is waiting for approval
      </p>
      <p className="mt-1.5 text-sm">
        Buy <span className="font-medium">{purchase ?? "an unknown item"}</span> for{" "}
        <span className="font-medium">{eth(held.value)} ETH</span> at {merchant?.name ?? held.target}?
      </p>
      <p className="mt-1 text-xs text-muted-foreground">This approves only this exact purchase, once, for the next hour.</p>
      {wrongPasskey && (
        <p className="mt-2 text-sm text-void">
          This card was issued with a passkey this browser doesn't have (another browser, or you chose a new passkey).
          Approve from the browser you issued it in.
        </p>
      )}
      {challenge.error && (
        <p className="mt-2 text-sm text-void">Couldn't prepare the approval: {challenge.error.message.split("\n")[0]}</p>
      )}
      <Button
        className="mt-3"
        onClick={() => approve.mutate()}
        disabled={approve.isPending || (passkey && (wrongPasskey || !challenge.data))}
      >
        {approve.isPending ? "Approving…" : passkey ? "Approve with Touch ID" : "Approve purchase"}
      </Button>
    </div>
  );
}

function TaskComposer({ card }: { card: Card }) {
  const merchant = useMerchant(card.merchant);
  const [goal, setGoal] = useState(() => savedGoal(card.id));
  const first = merchant?.items[0]?.name.toLowerCase();
  const example = first ? `Buy ${/^[aeiou]/.test(first) ? "an" : "a"} ${first}` : "Describe what to buy";
  return (
    <div className="space-y-3">
      <Label htmlFor="goal" className="text-base font-semibold">
        Give the agent a task
      </Label>
      <Textarea
        id="goal"
        value={goal}
        rows={2}
        placeholder={example}
        onChange={e => {
          setGoal(e.target.value);
          saveGoal(card.id, e.target.value);
        }}
        className="bg-card text-base"
      />
      <p className="text-sm text-muted-foreground">Run this in a terminal at the project root. The agent plans the purchase and the card enforces the limits.</p>
      <CommandBox command={agentCommand(card.id, goal.trim() || example)} />
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
