import { createFileRoute } from "@tanstack/react-router";
import { PaymentsPanel } from "@/x402/PaymentsPanel";
import { ProtectPayments } from "@/x402/ProtectPayments";

export const Route = createFileRoute("/payments")({ component: PaymentsPage });

function PaymentsPage() {
  return (
    <div className="max-w-5xl">
      <h1 className="font-display text-4xl sm:text-5xl">Payments</h1>
      <p className="mt-2 text-muted-foreground">
        Your AI agent buys data from a paid API (x402, USDC). Before it pays, Intercepta checks who gets the money; before
        the seller accepts it, Intercepta checks who is paying. Anything risky is blocked or waits for you.
      </p>
      <div className="mt-8">
        <ProtectPayments />
        <PaymentsPanel />
      </div>
    </div>
  );
}
