import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { erc20Abi, isAddress, parseUnits, zeroAddress, type Address } from "viem";
import { useConnection } from "wagmi";
import { MerchantCheck } from "@/components/merchant-check";
import { SecurityCard } from "@/components/security-card";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { issueCard } from "@/lib/actions";
import { publicClient } from "@/lib/chain";
import { approvalHook, DEFAULT_AGENT } from "@/lib/config";
import type { CardKind } from "@/lib/data";
import { eth, money, shortAddress, unit } from "@/lib/format";
import { saveGoal } from "@/lib/goals";
import { forgetPasskey, passkeysSupported, storedPasskey } from "@/lib/passkey";
import { useMerchants, useSnapshot } from "@/lib/hooks";
import { saveScreening, useScreening, type ScreeningResponse, type ScreeningStatus } from "@/lib/screening";
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

/** ETH (18 decimals) unless `asset` is set: then a 6-decimal token (USDC). */
function parseAmount(value: string, asset?: Address): bigint | null {
  try {
    const amount = parseUnits(value.trim() as `${number}`, asset ? 6 : 18);
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

  const [pickedKind, setKind] = useState<CardKind>("one-time");
  const [merchant, setMerchant] = useState<Address | "custom" | "">("");
  const [customMerchant, setCustomMerchant] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [acceptRisk, setAcceptRisk] = useState(false);
  const [revealed, setRevealed] = useState(false);

  // The check usually finishes before the dialog opens; a short scan keeps it visible as a step.
  useEffect(() => {
    if (!confirming) return setRevealed(false);
    const timer = setTimeout(() => setRevealed(true), 1100);
    return () => clearTimeout(timer);
  }, [confirming]);
  const [budget, setBudget] = useState("0.005");
  const [uses, setUses] = useState("3");
  const [duration, setDuration] = useState(durations[1].seconds);
  const [goal, setGoal] = useState("");
  const [agent, setAgent] = useState<string>(DEFAULT_AGENT);
  const [funding, setFunding] = useState("0.02");
  const [requireApproval, setRequireApproval] = useState(false);
  const [approvalOver, setApprovalOver] = useState("0.005");
  const [useTouchId, setUseTouchId] = useState(passkeysSupported);
  const [hasPasskey, setHasPasskey] = useState(() => storedPasskey() !== null);
  const [submitted, setSubmitted] = useState(false);

  const isCustom = merchant === "custom";
  const chosenMerchant = isCustom ? customMerchant.trim() : merchant || merchants?.[0]?.address || "";
  const merchantReady = isAddress(chosenMerchant);
  const chosen = merchants?.find(m => m.address.toLowerCase() === chosenMerchant.toLowerCase());
  const merchantName = chosen?.name;
  // An x402 seller: the card pays it in USDC over HTTP, so it's multi-use and budgeted in USDC.
  const asset = chosen?.asset;
  // Derived, not only set on the merchant click: typing a seller's address as a custom merchant must not leave a
  // one-time (ETH) card paying an x402 seller.
  const kind: CardKind = asset ? "multi-use" : pickedKind;
  const screening = useScreening(merchantReady ? chosenMerchant : undefined);
  const { data: hasShop } = useQuery({
    queryKey: ["has-shop", chosenMerchant.toLowerCase()],
    queryFn: async () => Boolean(await publicClient.getCode({ address: chosenMerchant as Address })),
    enabled: isCustom && merchantReady,
  });
  const budgetWei = parseAmount(budget, asset);
  const fundingWei = parseAmount(funding);
  const maxUses = kind === "one-time" ? 1 : Number(uses);
  const needsAccount = kind === "multi-use" && snapshot?.account === null;
  const accountBalance = snapshot?.account?.balance ?? 0n;
  const canRequireApproval = kind === "multi-use" && !asset && Boolean(approvalHook());
  const approvalThreshold = canRequireApproval && requireApproval ? parseAmount(approvalOver) : undefined;

  const errors = {
    budget: budgetWei === null ? "Enter a budget above 0, like 0.005" : undefined,
    uses:
      kind === "multi-use" && !(Number.isInteger(maxUses) && maxUses >= 1 && maxUses <= 1000)
        ? "Enter a whole number from 1 to 1000"
        : undefined,
    agent: !isAddress(agent) ? "Enter a valid 0x address" : undefined,
    merchant: isCustom && !merchantReady ? "Enter the merchant's 0x address" : undefined,
    funding: needsAccount && fundingWei === null ? "Enter an amount above 0" : undefined,
    approval: approvalThreshold === null ? "Enter an amount above 0, like 0.005" : undefined,
  };
  // A USDC card's budget comes from the owner's wallet (npm run demo gives it USDC on the fork).
  const { data: ownerUsdc } = useQuery({
    queryKey: ["owner-usdc", owner, asset],
    queryFn: () => publicClient.readContract({ address: asset!, abi: erc20Abi, functionName: "balanceOf", args: [owner!] }),
    enabled: Boolean(asset && owner),
  });
  const usdcShort = asset && budgetWei !== null && ownerUsdc !== undefined && budgetWei > ownerUsdc;
  const valid = !Object.values(errors).some(Boolean) && merchantReady && Boolean(owner) && !usdcShort;

  const issue = useMutation({
    mutationFn: () =>
      issueCard({
        kind,
        owner: owner!,
        merchant: chosenMerchant as Address,
        asset,
        agent: agent as Address,
        budget: budgetWei!,
        maxUses,
        validFor: duration,
        accountFunding: fundingWei ?? 0n,
        approvalThreshold: approvalThreshold ?? undefined,
        approveWithPasskey: useTouchId,
      }),
    onSuccess: async cardId => {
      if (goal.trim()) saveGoal(cardId, goal.trim());
      if (screening.data) saveScreening(cardId, screening.data);
      // This route has no snapshot observer, so invalidating alone leaves the previous (often empty) snapshot in cache.
      // Keep the issuing dialog open until the refreshed snapshot can render the new card.
      await queryClient.refetchQueries({ queryKey: ["snapshot"], type: "all" });
      toast.success("Card issued");
      navigate({ to: "/cards/$cardId", params: { cardId } });
    },
    onError: error => toast.error(error.message.split("\n")[0]),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (valid) {
      setAcceptRisk(false);
      setConfirming(true);
    }
  }

  const shortfall =
    kind === "multi-use" && !asset && !needsAccount && budgetWei !== null && budgetWei > accountBalance
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
                <RadioGroupItem
                  id={`kind-${option.value}`}
                  value={option.value}
                  className="mt-0.5"
                  disabled={option.value === "one-time" && Boolean(asset)}
                />
                <span>
                  <span className="block font-semibold">{option.title}</span>
                  <span className="mt-1 block text-sm leading-snug text-muted-foreground">
                    {option.value === "one-time" && asset ? `Not for ${merchantName}: it's paid in USDC over x402.` : option.body}
                  </span>
                </span>
              </Label>
            ))}
          </RadioGroup>
        </fieldset>

        <fieldset>
          <legend className="mb-3 font-semibold">Merchant</legend>
          {merchantsError && <p className="text-sm text-void">Couldn't load merchants. Is the demo running?</p>}
          <RadioGroup
            value={isCustom ? "custom" : chosenMerchant}
            onValueChange={value => {
              const next = merchants?.find(m => m.address === value);
              if (Boolean(next?.asset) !== Boolean(asset)) setBudget(next?.asset ? "0.05" : "0.005");
              setMerchant(value as Address | "custom");
            }}
            className="grid gap-3 sm:grid-cols-2"
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
                  {m.asset && (
                    <span className="shrink-0 rounded-full border border-current/30 px-1.5 py-px text-[0.65rem] font-medium whitespace-nowrap text-intaglio">
                      x402 · USDC
                    </span>
                  )}
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  {m.items.map(item => `${item.name} ${money(item.price, m.asset)}`).join(", ")}
                </span>
              </Label>
            ))}
            <Label
              htmlFor="merchant-custom"
              className={cn(
                "flex cursor-pointer flex-col items-start gap-2 rounded-xl border border-dashed border-input bg-card p-4 font-normal transition-colors sm:col-span-2",
                isCustom && "border-solid border-intaglio ring-1 ring-intaglio",
              )}
            >
              <span className="flex items-center gap-2">
                <RadioGroupItem id="merchant-custom" value="custom" />
                <span className="font-display text-xl leading-none">Another merchant</span>
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                Any address you choose. It's checked for scams, sanctions and stolen funds before the card is issued.
              </span>
            </Label>
          </RadioGroup>
          {isCustom && (
            <div className="mt-3">
              <Field
                label="Merchant address"
                htmlFor="custom-merchant"
                error={submitted ? errors.merchant : undefined}
                hint={
                  merchantReady && hasShop === false
                    ? "There's no shop contract at this address on the local chain, so the agent won't find anything to buy."
                    : undefined
                }
              >
                <Input
                  id="custom-merchant"
                  value={customMerchant}
                  placeholder="0x…"
                  onChange={e => setCustomMerchant(e.target.value)}
                  className="bg-card font-mono text-sm"
                  autoFocus
                />
              </Field>
            </div>
          )}
        </fieldset>

        <fieldset className="grid gap-5 sm:grid-cols-3">
          <legend className="mb-3 font-semibold">Limits</legend>
          <Field
            label={`Budget (${unit(asset)})`}
            htmlFor="budget"
            error={submitted ? errors.budget : undefined}
            hint={asset ? "Moves from your wallet into your account when the card is issued." : undefined}
          >
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

        {canRequireApproval && (
          <fieldset className="space-y-3 rounded-xl border border-border bg-card p-4">
            <label htmlFor="require-approval" className="flex items-center gap-2 font-semibold">
              <input
                id="require-approval"
                type="checkbox"
                checked={requireApproval}
                onChange={e => setRequireApproval(e.target.checked)}
                className="size-4 accent-[var(--banknote)]"
              />
              Ask for my approval before big purchases
            </label>
            {requireApproval && (
              <>
                <Field
                  label="Big means over (ETH)"
                  htmlFor="approval"
                  hint="Any single purchase over this waits until you approve that exact purchase."
                  error={submitted ? errors.approval : undefined}
                >
                  <Input
                    id="approval"
                    inputMode="decimal"
                    value={approvalOver}
                    onChange={e => setApprovalOver(e.target.value)}
                    className="bg-paper sm:max-w-48"
                  />
                </Field>
                {passkeysSupported() && (
                  <div className="space-y-1">
                    <label htmlFor="touch-id" className="flex items-center gap-2 text-sm">
                      <input
                        id="touch-id"
                        type="checkbox"
                        checked={useTouchId}
                        onChange={e => setUseTouchId(e.target.checked)}
                        className="size-4 accent-[var(--banknote)]"
                      />
                      Approve with Touch ID (your passkey), so the app's own key can't approve for you
                    </label>
                    {useTouchId && (
                      <p className="text-sm text-muted-foreground">
                        {hasPasskey
                          ? "Uses the passkey already saved in this browser. "
                          : "You'll be asked to create a passkey when you issue the card. "}
                        {hasPasskey && (
                          <button
                            type="button"
                            className="underline underline-offset-2"
                            onClick={() => {
                              forgetPasskey();
                              setHasPasskey(false);
                            }}
                          >
                            Use a new passkey
                          </button>
                        )}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </fieldset>
        )}

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
        {usdcShort && (
          <p className="rounded-lg bg-void/10 p-3 text-sm text-void">
            Your wallet holds {money(ownerUsdc!, asset)}, less than this budget. Lower the budget to issue the card.
          </p>
        )}

        <Button type="submit" size="lg">
          Review and issue
        </Button>
      </form>

      <aside className="lg:sticky lg:top-28">
        <p className="mb-3 text-sm text-muted-foreground">Preview</p>
        {(merchantReady || isCustom) && (
          <SecurityCard
            size="lg"
            card={{
              id: `preview-${kind}-${chosenMerchant || "custom"}`,
              kind,
              merchant: merchantReady ? (chosenMerchant as Address) : zeroAddress,
              asset,
              maxSpend: budgetWei ?? 0n,
              spent: 0n,
              maxUses: Number.isFinite(maxUses) && maxUses > 0 ? maxUses : 1,
              uses: 0,
              expiresAt: Date.now() / 1000 + duration,
              status: "active",
              approvalThreshold: approvalThreshold ?? undefined,
              approvalBy: useTouchId ? "passkey" : "owner",
            }}
          />
        )}
      </aside>

      <AlertDialog open={confirming} onOpenChange={open => !issue.isPending && setConfirming(open)}>
        <AlertDialogContent className="max-h-[92dvh] overflow-y-auto data-[size=default]:sm:max-w-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-3xl font-normal">Issue this card?</AlertDialogTitle>
            <AlertDialogDescription>
              The agent can spend up to {money(budgetWei ?? 0n, asset)} at this merchant, and only there.
              {asset && " It pays over x402, and Intercepta screens every payment before the card approves it."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <div className="space-y-4">
              <SecurityCard
                card={{
                  id: `preview-${kind}-${chosenMerchant}`,
                  kind,
                  merchant: merchantReady ? (chosenMerchant as Address) : zeroAddress,
                  asset,
                  maxSpend: budgetWei ?? 0n,
                  spent: 0n,
                  maxUses: Number.isFinite(maxUses) && maxUses > 0 ? maxUses : 1,
                  uses: 0,
                  expiresAt: Date.now() / 1000 + duration,
                  status: "active",
                }}
              />
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Type</dt>
                <dd>{kind === "one-time" ? "One-time" : `Multi-use, ${maxUses} uses`}</dd>
                <dt className="text-muted-foreground">Valid for</dt>
                <dd>{durations.find(d => d.seconds === duration)?.label}</dd>
                <dt className="text-muted-foreground">Agent</dt>
                <dd className="font-mono text-xs leading-5">{isAddress(agent) ? shortAddress(agent) : agent}</dd>
              </dl>
            </div>

            <div className="space-y-3">
              <MerchantCheck
                address={chosenMerchant}
                name={merchantName}
                result={screening.data ?? (screening.error ? unreachable(chosenMerchant, screening.error) : undefined)}
                pending={!revealed || (screening.isPending && !screening.error)}
              />
              {revealed && isCustom && hasShop === false && screening.data?.status !== "blocked" && (
                <p className="rounded-lg bg-paper-deep p-3 text-sm">
                  No shop contract lives at this address on the local chain, so the agent won't find anything to buy.
                </p>
              )}
            </div>
          </div>

          <ConfirmActions
            status={revealed ? (screening.data?.status ?? (screening.error ? "unverified" : undefined)) : undefined}
            acceptRisk={acceptRisk}
            onAcceptRisk={setAcceptRisk}
            issuing={issue.isPending}
            onIssue={() => issue.mutate()}
            onBack={() => setConfirming(false)}
          />
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function unreachable(address: string, error: Error): ScreeningResponse {
  return {
    address,
    status: "unverified",
    reasons: [],
    labels: [],
    screenedAt: new Date().toISOString(),
    detail: `The merchant check didn't respond (${error.message}).`,
  };
}

function ConfirmActions({
  status,
  acceptRisk,
  onAcceptRisk,
  issuing,
  onIssue,
  onBack,
}: {
  status: ScreeningStatus | undefined;
  acceptRisk: boolean;
  onAcceptRisk: (value: boolean) => void;
  issuing: boolean;
  onIssue: () => void;
  onBack: () => void;
}) {
  const risky = status === "caution" || status === "unverified";
  return (
    <AlertDialogFooter className="items-center gap-3 sm:justify-between">
      <div className="text-sm">
        {risky && (
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={acceptRisk}
              onChange={e => onAcceptRisk(e.target.checked)}
              className="size-4 accent-[var(--intaglio)]"
            />
            I understand the risk and still want to issue this card
          </label>
        )}
        {status === "blocked" && <p className="text-void">Choose a different merchant to continue.</p>}
      </div>
      <div className="flex gap-2">
        <AlertDialogCancel onClick={onBack} disabled={issuing}>
          {status === "blocked" ? "Choose another merchant" : "Back"}
        </AlertDialogCancel>
        {status !== "blocked" && (
          <Button onClick={onIssue} disabled={!status || issuing || (risky && !acceptRisk)}>
            {issuing ? "Issuing…" : !status ? "Checking…" : risky ? "Issue anyway" : "Issue card"}
          </Button>
        )}
      </div>
    </AlertDialogFooter>
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
