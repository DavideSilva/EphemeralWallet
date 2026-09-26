import { formatEther } from "viem";

export function eth(value: bigint, digits = 4): string {
  const n = Number(formatEther(value));
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function serial(cardId: string): string {
  const [wallet, permission] = cardId.split("-");
  if (!wallet.startsWith("0x")) return "specimen";
  const base = wallet.slice(2, 8).toUpperCase();
  return permission === undefined ? base : `${base}/${permission}`;
}

const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

export function time(seconds: number): string {
  return clock.format(seconds * 1000);
}

export function dayLabel(seconds: number): string {
  const date = new Date(seconds * 1000);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return day.format(date);
}

export function validity(expiresAt: number, now = Date.now() / 1000): string {
  const left = expiresAt - now;
  if (left <= 0) return `Expired at ${time(expiresAt)}`;
  const minutes = Math.max(1, Math.round(left / 60));
  if (minutes < 60) return `Valid for ${minutes} min`;
  if (left < 86400) return `Valid until ${time(expiresAt)}`;
  return `Valid until ${day.format(expiresAt * 1000)}`;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function agentCommand(cardId: string, goal: string): string {
  return `npm run agent -- ${cardId} ${shellQuote(goal.trim() || "describe the task")}`;
}
