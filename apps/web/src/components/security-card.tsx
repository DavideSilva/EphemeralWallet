import { Link } from "@tanstack/react-router";
import type { Card } from "@/lib/data";
import { zeroAddress } from "viem";
import { eth, serial, shortAddress, validity } from "@/lib/format";
import { useMerchant } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Guilloche } from "./guilloche";
import { StatusStamp } from "./status-stamp";

const themes = {
  "one-time": { paper: "#f2eff7", ink: "#4b3f72", label: "One-time card" },
  "multi-use": { paper: "#e9f1eb", ink: "#2f5d50", label: "Multi-use card" },
} as const;

export type CardFace = Pick<
  Card,
  "id" | "kind" | "merchant" | "maxSpend" | "spent" | "maxUses" | "uses" | "expiresAt" | "status" | "approvalThreshold"
>;

export function SecurityCard({
  card,
  size = "md",
  link = false,
  className,
}: {
  card: CardFace;
  size?: "md" | "lg";
  link?: boolean;
  className?: string;
}) {
  const merchant = useMerchant(card.merchant);
  const theme = themes[card.kind];
  const left = card.maxSpend > card.spent ? card.maxSpend - card.spent : 0n;
  const inactive = card.status !== "active";
  const number = serial(card.id);

  const face = (
    <div
      className={cn(
        "relative aspect-[1.586] w-full overflow-hidden rounded-[14px] shadow-[0_1px_0_rgba(255,255,255,.7)_inset,0_10px_24px_-14px_rgba(29,43,38,.45)] ring-1 ring-black/10",
        className,
      )}
      style={{ background: theme.paper, color: theme.ink }}
    >
      <div className={cn("absolute inset-0 transition-[filter] duration-500", inactive && "grayscale-[.7] opacity-70")}>
        <Guilloche seed={card.id} ink={theme.ink} />
        <div className={cn("relative flex h-full flex-col justify-between", size === "lg" ? "p-7" : "p-5")}>
          <div className="flex items-baseline justify-between text-[0.72rem] font-medium">
            <span className="flex items-baseline gap-2">
              {theme.label}
              {card.approvalThreshold !== undefined && (
                <span className="rounded-full border border-current/30 px-1.5 py-px text-[0.65rem] opacity-90">
                  Approval over {eth(card.approvalThreshold)} ETH
                </span>
              )}
            </span>
            <span className="opacity-75">{number === "specimen" ? "Specimen" : `Nº ${number}`}</span>
          </div>

          <div className={cn("font-display leading-none", size === "lg" ? "text-5xl" : "text-[2.1rem]")}>
            {merchant?.name ?? (card.merchant === zeroAddress ? "Another merchant" : shortAddress(card.merchant))}
          </div>

          <div className="flex items-end justify-between gap-3">
            <div>
              <div className={cn("font-display leading-none", size === "lg" ? "text-3xl" : "text-xl")}>
                {inactive ? eth(card.spent) : eth(left)}{" "}
                <span className="text-[0.6em]">{inactive ? "ETH spent" : "ETH left"}</span>
              </div>
              <div className="mt-1.5 text-[0.72rem] opacity-80">{statusLine(card)}</div>
            </div>
            {card.kind === "multi-use" && (
              <div className="flex flex-col items-end gap-1.5">
                <UseMarks uses={card.uses} maxUses={card.maxUses} />
                <span className="text-[0.72rem] opacity-80">
                  {card.uses} of {card.maxUses} uses
                </span>
              </div>
            )}
          </div>
        </div>
        <Microprint id={card.id} />
      </div>
      <StatusStamp status={card.status} size={size} />
    </div>
  );

  if (!link) return face;
  return (
    <Link
      to="/cards/$cardId"
      params={{ cardId: card.id }}
      className="block rounded-[14px] focus-visible:outline-offset-4"
      aria-label={`${theme.label} for ${merchant?.name ?? "merchant"}, ${card.status}`}
    >
      {face}
    </Link>
  );
}

function statusLine(card: CardFace) {
  if (card.status === "cancelled") return "Cancelled by the owner";
  if (card.status === "used") {
    if (card.kind === "one-time") return "Used once, now void";
    return card.uses >= card.maxUses ? "Every use spent" : "Budget spent";
  }
  return validity(card.expiresAt);
}

function UseMarks({ uses, maxUses }: { uses: number; maxUses: number }) {
  const shown = Math.min(maxUses, 10);
  return (
    <div className="flex gap-1" aria-hidden="true">
      {Array.from({ length: shown }, (_, i) => (
        <span
          key={i}
          className="size-2.5 rounded-full border border-current"
          style={{ background: i < uses ? "currentColor" : "transparent" }}
        />
      ))}
    </div>
  );
}

function Microprint({ id }: { id: string }) {
  const line = `${id.replace("-", " permit ")} ephemeral agent authority `.repeat(6);
  return (
    <div className="absolute inset-x-0 bottom-0 overflow-hidden whitespace-nowrap px-2 pb-[3px] text-[4.5px] leading-none tracking-[0.08em] opacity-45 select-none" aria-hidden="true">
      {line}
    </div>
  );
}
