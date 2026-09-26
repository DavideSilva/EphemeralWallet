import { Link, createFileRoute } from "@tanstack/react-router";
import { EmptyCards, WithSnapshot } from "@/components/chain-state";
import { SecurityCard } from "@/components/security-card";
import type { Card } from "@/lib/data";
import { cn } from "@/lib/utils";

const states = ["active", "inactive", "all"] as const;
const kinds = ["all", "one-time", "multi-use"] as const;
type State = (typeof states)[number];
type Kind = (typeof kinds)[number];

export const Route = createFileRoute("/cards/")({
  validateSearch: (search: Record<string, unknown>): { state?: State; kind?: Kind } => ({
    state: states.includes(search.state as State) ? (search.state as State) : undefined,
    kind: kinds.includes(search.kind as Kind) ? (search.kind as Kind) : undefined,
  }),
  component: Cards,
});

const stateLabels: Record<State, string> = { active: "Active", inactive: "Used, expired or void", all: "All" };
const kindLabels: Record<Kind, string> = { all: "Any type", "one-time": "One-time", "multi-use": "Multi-use" };

function Cards() {
  const { state = "all", kind = "all" } = Route.useSearch();

  const matches = (card: Card) =>
    (state === "all" || (state === "active") === (card.status === "active")) && (kind === "all" || card.kind === kind);

  return (
    <div>
      <h1 className="font-display text-4xl sm:text-5xl">Cards</h1>
      <div className="mt-6 flex flex-wrap gap-x-6 gap-y-3">
        <Filter label="Status" options={states} labels={stateLabels} value={state} param="state" />
        <Filter label="Type" options={kinds} labels={kindLabels} value={kind} param="kind" />
      </div>

      <div className="mt-8">
        <WithSnapshot>
          {({ cards }) => {
            if (cards.length === 0) return <EmptyCards />;
            const filtered = cards.filter(matches);
            if (filtered.length === 0) {
              return (
                <p className="text-muted-foreground">
                  No cards match these filters.{" "}
                  <Link to="/cards" search={{}} className="font-medium text-intaglio hover:underline">
                    Show all cards
                  </Link>
                </p>
              );
            }
            return (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map(card => (
                  <SecurityCard key={card.id} card={card} link />
                ))}
              </div>
            );
          }}
        </WithSnapshot>
      </div>
    </div>
  );
}

function Filter<T extends string>({
  label,
  options,
  labels,
  value,
  param,
}: {
  label: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T;
  param: "state" | "kind";
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1 rounded-lg bg-paper-deep p-1">
      {options.map(option => (
        <Link
          key={option}
          to="/cards"
          search={prev => ({ ...prev, [param]: option === "all" ? undefined : option })}
          aria-current={value === option ? "true" : undefined}
          className={cn(
            "rounded-md px-3 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
            value === option && "bg-card text-foreground shadow-sm",
          )}
        >
          {labels[option]}
        </Link>
      ))}
    </div>
  );
}
