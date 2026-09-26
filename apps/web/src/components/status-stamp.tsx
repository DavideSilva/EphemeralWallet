import { AnimatePresence, motion } from "motion/react";
import type { CardStatus } from "@/lib/data";

const labels: Record<Exclude<CardStatus, "active">, string> = {
  cancelled: "Void",
  used: "Used",
  expired: "Expired",
};

export function StatusStamp({ status, size = "md" }: { status: CardStatus; size?: "md" | "lg" }) {
  return (
    <AnimatePresence initial={false}>
      {status !== "active" && (
        <motion.div
          key={status}
          initial={{ opacity: 0, scale: 1.6 }}
          animate={{ opacity: 0.88, scale: 1 }}
          transition={{ type: "spring", stiffness: 520, damping: 26 }}
          className="pointer-events-none absolute inset-0 flex items-center justify-end pr-[9%]"
        >
          <span
            className={`font-display -rotate-12 rounded-sm border-[3px] border-double px-3 pt-1 uppercase tracking-[0.18em] mix-blend-multiply ${
              size === "lg" ? "text-5xl" : "text-3xl"
            } ${status === "cancelled" ? "border-void text-void" : "border-ink/70 text-ink/70"}`}
          >
            {labels[status]}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
