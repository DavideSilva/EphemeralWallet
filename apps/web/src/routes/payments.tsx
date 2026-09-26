import { createFileRoute } from "@tanstack/react-router";
import { PaymentsPanel } from "@/x402/PaymentsPanel";

export const Route = createFileRoute("/payments")({ component: PaymentsPage });

function PaymentsPage() {
  return (
    <div className="max-w-5xl">
      <h1 className="font-display text-4xl sm:text-5xl">Payments</h1>
      <p className="mt-2 text-muted-foreground">
        Your agent paying x402 services in USDC. Intercepta screens every payee, token and authorization before the
        wallet approves it, and the service screens the payer before it settles.
      </p>
      <div className="mt-8">
        <PaymentsPanel />
      </div>
    </div>
  );
}
