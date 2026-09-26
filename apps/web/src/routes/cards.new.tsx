import { useState, type FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { isAddress, parseEther, type Address } from "viem";
import { useConnection } from "wagmi";
import { SecurityCard } from "@/components/security-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { issueCard } from "@/lib/actions";
import { DEFAULT_AGENT } from "@/lib/config";
import type { CardKind } from "@/lib/data";
import { eth } from "@/lib/format";
import { saveGoal } from "@/lib/goals";
import { useMerchants, useSnapshot } from "@/lib/hooks";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/cards/new")({ component: IssueCard });

const durations = [
  { label: "15 minutes", seconds: 15 * 60 },
  { label: "1 hour", seconds: 60 * 60 },
  { label: "1 day", seconds: 24 * 60 * 60 },
];

const kinds: { value: CardKind; title: string; body: string }[] = [
  {
    value: "one-time",
    title: "One-time",
    body: "Gets its own wallet, funded with the budget. One purchase, then it's used up.",
  },
  {
    value: "multi-use",
    title: "Multi-use",
    body: "Draws from your account. The agent can buy several times until the budget or uses run out.",
  },
];

function parseAmount(value: string): bigint | null {
  try {
    const amount = parseEther(value.trim() as `${number}`);
    return amount > 0n ? amount : null;
  } catch {
    return null;
  }
}

function IssueCard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { address: owner } = useConnection();
  const { data: merchants, error: merchantsError } = useMerchants();
  const { data: snapshot } = useSnapshot();

  const [kind, setKind] = useState<CardKind>("one-time");
  const [merchant, setMerchant] = useState<Address | "">("");
  const [budget, setBudget] = useState("0.005");
  const [uses, setUses] = useState("3");
  const [duration, setDuration] = useState(durations[1].seconds);
  const [goal, setGoal] = useState("");
  const [agent, setAgent] = useState<string>(DEFAULT_AGENT);
  const [funding, setFunding] = useState("0.02");
  const [submitted, setSubmitted] = useState(false);

  const chosenMerchant = merchant || merchants?.[0]?.address || "";
  const budgetWei = parseAmount(budget);
  const fundingWei = parseAmount(funding);
  const maxUses = kind === "one-time" ? 1 : Number(uses);
  const needsAccount = kind === "multi-use" && snapshot?.account === null;
  const accountBalance = snapshot?.account?.balance ?? 0n;

  const errors = {
    budget: budgetWei === null ? "Enter a budget above 0, like 0.005" : undefined,
    uses:
      kind === "multi-use" && !(Number.isInteger(maxUses) && maxUses >= 1 && maxUses <= 1000)
        ? "Enter a whole number from 1 to 1000"
        : undefined,
    agent: !isAddress(agent) ? "Enter a valid 0x address" : undefined,
    funding: needsAccount && fundingWei === null ? "Enter an amount above 0" : undefined,
  };
  const valid = !Object.values(errors).some(Boolean) && Boolean(chosenMerchant) && Boolean(owner);

  const issue = useMutation({
    mutationFn: () =>
      issueCard({
        kind,
        owner: owner!,
        merchant: chosenMerchant as Address,
        agent: agent as Address,
        budget: budgetWei!,
        maxUses,
        validFor: duration,
        accountFunding: fundingWei ?? 0n,
      }),
    onSuccess: async cardId => {
      if (goal.trim()) saveGoal(cardId, goal.trim());
      await queryClient.invalidateQueries({ queryKey: ["snapshot"] });
      toast.success("Card issued");
      navigate({ to: "/cards/$cardId", params: { cardId } });
    },
    onError: error => toast.error(error.message.split("\n")[0]),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (valid) issue.mutate();
  }

  const shortfall =
    kind === "multi-use" && !needsAccount && budgetWei !== null && budgetWei > accountBalance
      ? `Your account holds ${eth(accountBalance)} ETH, less than this budget. Purchases will fail once it runs dry, so add funds from the home page.`
      : undefined;

  return (
    <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
      <form onSubmit={submit} className="space-y-9" noValidate>
        <div>
          <h1 className="font-display text-4xl sm:text-5xl">Issue a card</h1>
          <p className="mt-2 max-w-xl text-muted-foreground">
            Choose where the agent may spend, how much, and for how long. The card enforces these limits on-chain, whatever the agent decides.
          </p>
        </div>

        <fieldset className="space-y-3">
          <legend className="mb-3 font-semibold">Card type</legend>
          <RadioGroup value={kind} onValueChange={value => setKind(value as CardKind)} className="grid gap-3 sm:grid-cols-2">
            {kinds.map(option => (
              <Label
                key={option.value}
                htmlFor={`kind-${option.value}`}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-4 font-normal transition-colors",
                  kind === option.value && "border-intaglio ring-1 ring-intaglio",
                )}
              >
                <RadioGroupItem id={`kind-${option.value}`} value={option.value} className="mt-0.5" />
                <span>
                  <span className="block font-semibold">{option.title}</span>
                  <span className="mt-1 block text-sm leading-snug text-muted-foreground">{option.body}</span>
                </span>
              </Label>
            ))}
          </RadioGroup>
        </fieldset>

        <fieldset>
          <legend className="mb-3 font-semibold">Merchant</legend>
          {merchantsError && <p className="text-sm text-void">Couldn't load merchants. Is the demo running?</p>}
          <RadioGroup
            value={chosenMerchant}
            onValueChange={value => setMerchant(value as Address)}
            className="grid gap-3 sm:grid-cols-3"
          >
            {merchants?.map(m => (
              <Label
                key={m.address}
                htmlFor={`merchant-${m.address}`}
                className={cn(
                  "flex cursor-pointer flex-col items-start gap-2 rounded-xl border border-border bg-card p-4 font-normal transition-colors",
                  chosenMerchant === m.address && "border-intaglio ring-1 ring-intaglio",
                )}
              >
                <span className="flex items-center gap-2">
                  <RadioGroupItem id={`merchant-${m.address}`} value={m.address} />
                  <span className="font-display text-xl leading-none">{m.name}</span>
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  {m.items.map(item => `${item.name} ${eth(item.price)}`).join(", ")}
                </span>
              </Label>
            ))}
          </RadioGroup>
        </fieldset>

        <fieldset className="grid gap-5 sm:grid-cols-3">
          <legend className="mb-3 font-semibold">Limits</legend>
          <Field label="Budget (ETH)" htmlFor="budget" error={submitted ? errors.budget : undefined}>
            <Input id="budget" inputMode="decimal" value={budget} onChange={e => setBudget(e.target.value)} className="bg-card" />
          </Field>
          {kind === "multi-use" && (
            <Field label="Uses" htmlFor="uses" error={submitted ? errors.uses : undefined}>
              <Input id="uses" inputMode="numeric" value={uses} onChange={e => setUses(e.target.value)} className="bg-card" />
            </Field>
          )}
          <Field label="Valid for" htmlFor="duration">
            <select
              id="duration"
              value={duration}
              onChange={e => setDuration(Number(e.target.value))}
              className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
            >
              {durations.map(d => (
                <option key={d.seconds} value={d.seconds}>
                  {d.label}
                </option>
              ))}
            </select>
          </Field>
        </fieldset>

        {kind === "one-time" && (
          <Field label="Task for the agent (optional)" htmlFor="goal" hint="Saved with the card so its command is ready to copy.">
            <Textarea
              id="goal"
              rows={2}
              value={goal}
              onChange={e => setGoal(e.target.value)}
              placeholder="Get me a flat white"
              className="bg-card"
            />
          </Field>
        )}

        <Field
          label="Agent address"
          htmlFor="agent"
          hint="The only address allowed to use this card. Defaults to Anvil account #1."
          error={submitted ? errors.agent : undefined}
        >
          <Input id="agent" value={agent} onChange={e => setAgent(e.target.value)} className="bg-card font-mono text-sm" />
        </Field>

        {needsAccount && (
          <Field
            label="Open your account with (ETH)"
            htmlFor="funding"
            hint="Multi-use cards draw from one account. This is your first, so it's opened and funded now."
            error={submitted ? errors.funding : undefined}
          >
            <Input id="funding" inputMode="decimal" value={funding} onChange={e => setFunding(e.target.value)} className="bg-card" />
          </Field>
        )}
        {shortfall && <p className="rounded-lg bg-intaglio/10 p-3 text-sm text-intaglio">{shortfall}</p>}

        <Button type="submit" size="lg" disabled={issue.isPending}>
          {issue.isPending ? "Issuing…" : "Issue card"}
        </Button>
      </form>

      <aside className="lg:sticky lg:top-28">
        <p className="mb-3 text-sm text-muted-foreground">Preview</p>
        {chosenMerchant && (
          <SecurityCard
            size="lg"
            card={{
              id: `preview-${kind}-${chosenMerchant}`,
              kind,
              merchant: chosenMerchant as Address,
              maxSpend: budgetWei ?? 0n,
              spent: 0n,
              maxUses: Number.isFinite(maxUses) && maxUses > 0 ? maxUses : 1,
              uses: 0,
              expiresAt: Date.now() / 1000 + duration,
              status: "active",
            }}
          />
        )}
      </aside>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-sm text-void">{error}</p>
      ) : (
        hint && <p className="text-sm text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
