import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { Ban, BadgeCheck, Hourglass, ShieldX, ShoppingBag, Stamp, Undo2 } from "lucide-react";
import type { Activity, Card } from "@/lib/data";
import { amount as formatAmount, dayLabel, money, shortAddress, time, unit } from "@/lib/format";
import { useMerchants } from "@/lib/hooks";
import { cn } from "@/lib/utils";

const icons = {
  issued: Stamp,
  purchase: ShoppingBag,
  blocked: ShieldX,
  approved: BadgeCheck,
  cancelled: Ban,
  refund: Undo2,
} as const;

export function ActivityList({
  activity,
  cards,
  groupByDay = false,
  showCard = true,
}: {
  activity: Activity[];
  cards: Card[];
  groupByDay?: boolean;
  showCard?: boolean;
}) {
  const groups = groupByDay
    ? activity.reduce<{ day: string; items: Activity[] }[]>((acc, item) => {
        const day = dayLabel(item.at);
        const last = acc.at(-1);
        if (last?.day === day) last.items.push(item);
        else acc.push({ day, items: [item] });
        return acc;
      }, [])
    : [{ day: "", items: activity }];

  return (
    <div className="space-y-8">
      {groups.map(group => (
        <section key={group.day || "all"}>
          {group.day && <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{group.day}</h3>}
          <ul className="divide-y divide-border/80 border-y border-border/80">
            <AnimatePresence initial={false}>
              {group.items.map(item => (
                <motion.li
                  key={item.id}
                  layout="position"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                >
                  <ActivityRow item={item} card={cards.find(c => c.id === item.cardId)} showCard={showCard} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </section>
      ))}
    </div>
  );
}

function ActivityRow({ item, card, showCard }: { item: Activity; card?: Card; showCard: boolean }) {
  const { data: merchants } = useMerchants();
  const merchant =
    merchants?.find(m => m.address.toLowerCase() === card?.merchant.toLowerCase())?.name ??
    (card ? shortAddress(card.merchant) : "an unknown merchant");
  const held = item.kind === "blocked" ? item.held : undefined;
  const Icon = held ? Hourglass : icons[item.kind];
  const blocked = item.kind === "blocked" && !held;
  const kindLabel = card?.kind === "one-time" ? "one-time" : "multi-use";

  const title = {
    issued: `Issued a ${kindLabel} card for ${merchant}`,
    purchase:
      item.payment === "pending"
        ? `Paying for ${item.summary ?? "an item"} at ${merchant}`
        : item.payment === "lapsed"
          ? `Payment not collected: ${item.summary ?? "an item"} at ${merchant}`
          : `Bought ${item.summary ?? "an item"} at ${merchant}`,
    blocked: held
      ? held.state === "waiting"
        ? "Held: waiting for your approval"
        : held.state === "expired"
          ? "Held: your approval expired"
          : held.state === "timed-out"
            ? "Held: not approved while the agent waited"
          : "Held for your approval"
      : `Blocked: ${item.reason ?? "rejected by the card"}`,
    approved: `You approved ${item.summary ?? "a purchase"}${card?.approvalBy === "passkey" ? " with Touch ID" : ""}`,
    cancelled: `Cancelled the ${merchant} card`,
    refund: `Returned leftovers from the ${merchant} card`,
  }[item.kind];

  const detail =
    item.kind === "blocked"
      ? `Agent tried ${item.summary ?? "a purchase"} at ${merchant}`
      : item.kind === "cancelled" && item.value
        ? `${money(item.value, item.asset)} refunded`
        : item.kind === "issued" && item.value !== undefined
          ? `Budget ${money(item.value, item.asset)}`
          : item.payment === "pending"
            ? "Approved by the card, waiting for the seller to collect"
            : item.payment === "lapsed"
              ? "The seller never collected it, so no USDC left your account. The card still counts it as spent."
              : undefined;

  const amount =
    item.value === undefined || item.kind === "issued"
      ? null
      : item.kind === "purchase"
        ? item.payment === "lapsed"
          ? formatAmount(item.value, item.asset)
          : `−${formatAmount(item.value, item.asset)}`
        : item.kind === "blocked" || item.kind === "approved"
          ? formatAmount(item.value, item.asset)
          : `+${formatAmount(item.value, item.asset)}`;

  const row = (
    <div className="grid grid-cols-[2.75rem_1.75rem_1fr_auto] items-start gap-x-3 py-3.5">
      <span className="pt-0.5 text-sm text-muted-foreground">{time(item.at)}</span>
      <span
        className={cn(
          "mt-0.5 grid size-6 place-items-center rounded-full",
          held
            ? "bg-amber-500/15 text-amber-700"
            : blocked
              ? "bg-void/10 text-void"
              : item.kind === "purchase" || item.kind === "approved"
                ? "bg-banknote/10 text-banknote"
                : "bg-intaglio/10 text-intaglio",
        )}
      >
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className={cn("font-medium leading-snug", blocked && "text-void", held && "text-amber-800")}>{title}</p>
        {item.memo && <p className="mt-0.5 truncate text-sm text-muted-foreground">“{item.memo}”</p>}
        {detail && <p className="mt-0.5 text-sm text-muted-foreground">{detail}</p>}
      </div>
      {amount && (
        <span
          className={cn(
            "pt-0.5 text-right font-medium whitespace-nowrap",
            blocked && "text-void/70",
            held && "text-amber-800/80",
            item.payment === "lapsed" && "text-muted-foreground",
            (item.kind === "refund" || item.kind === "cancelled") && "text-banknote",
          )}
        >
          <span className={cn((blocked || item.payment === "lapsed") && "line-through")}>{amount}</span>{" "}
          <span className="text-xs text-muted-foreground">{unit(item.asset)}</span>
        </span>
      )}
    </div>
  );

  if (!showCard || !card) return row;
  return (
    <Link
      to="/cards/$cardId"
      params={{ cardId: card.id }}
      className="-mx-2 block rounded-lg px-2 transition-colors hover:bg-paper-deep/70"
    >
      {row}
    </Link>
  );
}
