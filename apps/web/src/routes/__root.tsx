import { Link, Outlet, createRootRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useBalance, useConnection } from "wagmi";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { eth, shortAddress } from "@/lib/format";
import { useChainRefresh } from "@/lib/hooks";

export const Route = createRootRoute({ component: Root, notFoundComponent: NotFound });

const navLink =
  "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-[status=active]:bg-paper-deep data-[status=active]:text-foreground";

function Root() {
  useChainRefresh();
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[90rem] items-center gap-2 px-4 sm:gap-6 sm:px-8 lg:px-12">
          <Link to="/" className="font-display text-2xl leading-none tracking-tight">
            Ephemeral
          </Link>
          <nav className="flex items-center gap-1">
            <Link to="/cards" className={navLink}>
              Cards
            </Link>
            <Link to="/activity" className={navLink}>
              Activity
            </Link>
            <Link to="/payments" className={navLink}>
              Payments
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <OwnerChip />
            <Button asChild size="sm">
              <Link to="/cards/new">
                <Plus /> <span className="hidden sm:inline">Issue card</span>
              </Link>
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[90rem] px-4 pt-8 pb-24 sm:px-8 sm:pt-12 lg:px-12">
        <Outlet />
      </main>
      <Toaster position="bottom-right" />
    </div>
  );
}

function OwnerChip() {
  const { address } = useConnection();
  const { data: balance } = useBalance({ address, query: { refetchInterval: 4_000 } });
  if (!address) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-sm md:flex">
          <span className="size-2 rounded-full bg-banknote" aria-hidden="true" />
          <span className="font-mono text-xs">{shortAddress(address)}</span>
          {balance && <span className="text-muted-foreground">{eth(balance.value, 2)} ETH</span>}
        </div>
      </TooltipTrigger>
      <TooltipContent>Owner wallet, signing on the local Anvil chain</TooltipContent>
    </Tooltip>
  );
}

function NotFound() {
  return (
    <div className="max-w-md">
      <h1 className="font-display text-4xl">Nothing here</h1>
      <p className="mt-3 text-muted-foreground">This page doesn't exist.</p>
      <Button asChild className="mt-6" variant="outline">
        <Link to="/">Back to your cards</Link>
      </Button>
    </div>
  );
}
