import { decodeAbiParameters, decodeFunctionData, parseAbiItem, slice, zeroAddress, type Address, type Hex } from "viem";
import {
  approvalHookAbi,
  merchantAbi,
  missionFactoryAbi,
  missionWalletAbi,
  reusableFactoryAbi,
  reusableWalletAbi,
} from "@shared/abis";
import { erc20Abi } from "@shared/abi";
import { APPROVAL_WAIT_SECONDS } from "@shared/approval";
import { decodePurchase, decodeRevert, describeRevert, revertData } from "@shared/revert";
import { publicClient } from "./chain";
import { approvalHook, contracts, FROM_BLOCK, USDC, weatherPayee } from "./config";

/**
 * A shop contract the agent calls with ETH, or (`asset` set) an x402 seller: `address` is then the seller's payee
 * and the agent pays it in that token over HTTP, screened by Intercepta before the card approves each payment.
 */
export type Merchant = { address: Address; name: string; items: readonly { name: string; price: bigint }[]; asset?: Address };

export type CardKind = "one-time" | "multi-use";
export type CardStatus = "active" | "used" | "expired" | "cancelled";

export type Card = {
  id: string;
  kind: CardKind;
  wallet: Address;
  permissionId?: bigint;
  agent: Address;
  merchant: Address;
  /** Set for cards that pay in a token (USDC, for x402 sellers); unset means ETH. */
  asset?: Address;
  maxSpend: bigint;
  spent: bigint;
  maxUses: number;
  uses: number;
  expiresAt: number;
  issuedAt: number;
  cancelled: boolean;
  /** Funds held by a one-time card's own wallet; multi-use cards draw from the account instead. */
  balance: bigint;
  status: CardStatus;
  /** Purchases above this need the owner's approval (the approval plugin is attached). */
  approvalThreshold?: bigint;
  /** Who approves: the owner's passkey (Touch ID), or the owner's account. */
  approvalBy?: "passkey" | "owner";
  /** For passkey cards: the passkey's public key (x ‖ y), to check this browser holds the matching passkey. */
  approvalPublicKey?: Hex;
};

export type ActivityKind = "issued" | "purchase" | "blocked" | "approved" | "cancelled" | "refund";

/** A purchase the approval plugin held, and where its approval stands. */
export type Held = {
  hook: Address;
  requestKey: Hex;
  wallet: Address;
  permissionId: bigint;
  target: Address;
  value: bigint;
  data: Hex;
  /** "timed-out": nobody approved it while the agent was still waiting, so approving now would do nothing. */
  state: "waiting" | "timed-out" | "approved" | "used" | "expired";
};

export type Activity = {
  id: string;
  kind: ActivityKind;
  cardId: string;
  at: number;
  block: bigint;
  position: number;
  hash: Hex;
  value?: bigint;
  /** The token `value` is in; unset means ETH. */
  asset?: Address;
  memo?: string;
  summary?: string;
  reason?: string;
  held?: Held;
  /**
   * x402 card payments only. The card approved the payment, but USDC moves only when the seller settles it:
   * "pending" can still settle, "lapsed" never will (its authorization expired unsettled).
   */
  payment?: PaymentState;
};

export type PaymentState = "settled" | "pending" | "lapsed";

/** `pendingUsdc`: approved x402 payments that may still settle, so it must stay in the account. */
export type Account = { address: Address; balance: bigint; usdc: bigint; pendingUsdc: bigint };

export type Snapshot = {
  owner: Address;
  account: Account | null;
  cards: Card[];
  activity: Activity[];
};

export function cardId(wallet: Address, permissionId?: bigint): string {
  const base = wallet.toLowerCase();
  return permissionId === undefined ? base : `${base}-${permissionId}`;
}

function status(card: Omit<Card, "status">, now: number): CardStatus {
  if (card.cancelled) return "cancelled";
  if (card.uses >= card.maxUses || (card.maxSpend > 0n && card.spent >= card.maxSpend)) return "used";
  if (now > card.expiresAt) return "expired";
  return "active";
}

export async function fetchMerchants(): Promise<Merchant[]> {
  const shops = await Promise.all(
    contracts().merchants.map(async address => {
      const [name, items] = await Promise.all([
        publicClient.readContract({ address, abi: merchantAbi, functionName: "name" }),
        publicClient.readContract({ address, abi: merchantAbi, functionName: "items" }),
      ]);
      return { address, name, items };
    }),
  );
  const payee = weatherPayee();
  // The price is apps/weather's ($0.01); the agent reads the live one from the service's 402 response.
  const weather: Merchant[] = payee
    ? [{ address: payee, name: "Mount Fuji Weather", items: [{ name: "Mount Fuji weather report", price: 10_000n }], asset: USDC }]
    : [];
  return [...shops, ...weather];
}

/** What an x402 payment bought: the seller's item at that price, if it matches one. */
function describePayment(merchants: Merchant[], payTo: Address, value: bigint): string | undefined {
  const seller = merchants.find(m => m.asset && m.address.toLowerCase() === payTo.toLowerCase());
  return seller?.items.find(item => item.price === value)?.name;
}

export function describePurchase(merchants: Merchant[], merchant: Address, data: Hex): string | undefined {
  const purchase = decodePurchase(data);
  if (!purchase) return undefined;
  const catalog = merchants.find(m => m.address.toLowerCase() === merchant.toLowerCase());
  const item = catalog?.items[Number(purchase.itemId)];
  const name = item?.name ?? `item #${purchase.itemId}`;
  return purchase.quantity === 1n ? name : `${purchase.quantity} × ${name}`;
}

const blockTimes = new Map<bigint, number>();

async function timestamps(blocks: bigint[]) {
  const missing = [...new Set(blocks)].filter(b => !blockTimes.has(b));
  await Promise.all(
    missing.map(async blockNumber => {
      const block = await publicClient.getBlock({ blockNumber });
      blockTimes.set(blockNumber, Number(block.timestamp));
    }),
  );
}

const at = (block: bigint) => blockTimes.get(block) ?? 0;

type BlockedScan = { chainStart: Hex | undefined; scannedTo: bigint; found: Activity[] };
const scan: BlockedScan = { chainStart: undefined, scannedTo: FROM_BLOCK - 1n, found: [] };

async function scanBlocked(
  toBlock: bigint,
  missionWallets: Set<string>,
  account: Address | null,
  merchants: Merchant[],
  targetOf: Map<string, Address>,
): Promise<Activity[]> {
  for (let blockNumber = scan.scannedTo + 1n; blockNumber <= toBlock; blockNumber++) {
    const block = await publicClient.getBlock({ blockNumber, includeTransactions: true });
    blockTimes.set(blockNumber, Number(block.timestamp));

    for (const tx of block.transactions) {
      const to = tx.to?.toLowerCase();
      if (!to) continue;
      const isMission = missionWallets.has(to);
      const isAccount = account !== null && to === account.toLowerCase();
      if (!isMission && !isAccount) continue;

      const receipt = await publicClient.getTransactionReceipt({ hash: tx.hash });
      if (receipt.status !== "reverted") continue;

      let id: string;
      let target: Address;
      let permissionId: bigint | undefined;
      let value: bigint;
      let data: Hex;
      let memo: string;
      try {
        if (isMission) {
          const call = decodeFunctionData({ abi: missionWalletAbi, data: tx.input });
          if (call.functionName !== "execute") continue;
          [target, value, data, memo] = call.args;
          id = cardId(tx.to!);
        } else {
          const call = decodeFunctionData({ abi: reusableWalletAbi, data: tx.input });
          if (call.functionName !== "execute") continue;
          [permissionId, target, value, data, memo] = call.args;
          id = cardId(tx.to!, permissionId);
        }
      } catch {
        continue;
      }

      const merchant = targetOf.get(id);
      const revert = await revertData(publicClient.request, tx.hash);
      const decoded = decodeRevert(revert);
      const held: Held | undefined =
        decoded?.name === "ApprovalRequired" && decoded.hook && permissionId !== undefined
          ? {
              hook: decoded.hook,
              requestKey: decoded.args![0] as Hex,
              wallet: tx.to!,
              permissionId,
              target,
              value,
              data,
              state: "waiting",
            }
          : undefined;
      scan.found.push({
        id: `blocked-${tx.hash}`,
        kind: "blocked",
        cardId: id,
        at: Number(block.timestamp),
        block: blockNumber,
        position: order(tx.transactionIndex ?? 0),
        hash: tx.hash,
        value,
        memo,
        summary: merchant ? describePurchase(merchants, merchant, data) : undefined,
        reason: describeRevert(revert),
        held,
      });
    }
  }
  scan.scannedTo = toBlock;
  return scan.found;
}

async function resetIfChainRestarted(toBlock: bigint) {
  const genesis = (await publicClient.getBlock({ blockNumber: FROM_BLOCK })).hash;
  if (scan.chainStart !== genesis || toBlock < scan.scannedTo) {
    scan.chainStart = genesis;
    scan.scannedTo = FROM_BLOCK - 1n;
    scan.found = [];
    blockTimes.clear();
    validBefores.clear();
  }
}

// EIP-3009: USDC emits this when an authorization settles (or is cancelled), keyed by the paying wallet.
const authorizationUsed = parseAbiItem("event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)");

// approvePayment's validBefore, by transaction: the PaymentApproved event doesn't carry it.
const validBefores = new Map<Hex, number>();

/**
 * Up to when an approved payment can settle. Falls back to the card's expiry, which approvePayment
 * guarantees is no earlier, if the approval's calldata can't be read.
 */
async function settleableUntil(account: Address, hash: Hex, cardExpiresAt: number): Promise<number> {
  const cached = validBefores.get(hash);
  if (cached !== undefined) return cached;
  let until = cardExpiresAt;
  try {
    const tx = await publicClient.getTransaction({ hash });
    if (tx.to?.toLowerCase() === account.toLowerCase()) {
      const call = decodeFunctionData({ abi: reusableWalletAbi, data: tx.input });
      if (call.functionName === "approvePayment") until = Number(call.args[4]);
    }
  } catch {
    // Keep the card's expiry: the later bound, so a payment is never treated as lapsed too early.
  }
  validBefores.set(hash, until);
  return until;
}

// Orders activity within a block: by transaction, then by log inside it.
const order = (transactionIndex: number, logIndex = 0) => transactionIndex * 10_000 + logIndex;

export async function fetchSnapshot(owner: Address, merchants: Merchant[]): Promise<Snapshot> {
  const { missionFactory, reusableFactory } = contracts();
  const toBlock = await publicClient.getBlockNumber();
  await resetIfChainRestarted(toBlock);
  // The chain's "now" (the pending block's time), not this computer's clock: card expiry and payment windows are
  // enforced on chain, and a local fork's clock can drift from this one.
  const now = Number((await publicClient.getBlock({ blockTag: "pending" })).timestamp);

  const [missionLogs, accountAddress] = await Promise.all([
    publicClient.getContractEvents({
      address: missionFactory,
      abi: missionFactoryAbi,
      eventName: "MissionCreated",
      args: { owner },
      fromBlock: FROM_BLOCK,
      toBlock,
    }),
    publicClient.readContract({
      address: reusableFactory,
      abi: reusableFactoryAbi,
      functionName: "lastWallet",
      args: [owner],
      blockNumber: toBlock,
    }),
  ]);
  const account = accountAddress === zeroAddress ? null : accountAddress;
  const missionWallets = missionLogs.map(log => log.args.wallet!);

  const [missionEvents, missionFlags, accountEvents, accountBalance, accountUsdc, permissionCount, settled] = await Promise.all([
    missionWallets.length
      ? publicClient.getContractEvents({ address: missionWallets, abi: missionWalletAbi, fromBlock: FROM_BLOCK, toBlock })
      : Promise.resolve([]),
    Promise.all(
      missionWallets.map(address =>
        Promise.all([
          publicClient.readContract({ address, abi: missionWalletAbi, functionName: "used", blockNumber: toBlock }),
          publicClient.readContract({ address, abi: missionWalletAbi, functionName: "cancelled", blockNumber: toBlock }),
          publicClient.getBalance({ address, blockNumber: toBlock }),
        ]),
      ),
    ),
    account
      ? publicClient.getContractEvents({ address: account, abi: reusableWalletAbi, fromBlock: FROM_BLOCK, toBlock })
      : Promise.resolve([]),
    account ? publicClient.getBalance({ address: account, blockNumber: toBlock }) : Promise.resolve(0n),
    // No USDC contract on a plain Anvil chain (only on the Base Sepolia fork): read that as none.
    account
      ? publicClient
          .readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [account], blockNumber: toBlock })
          .catch(() => 0n)
      : Promise.resolve(0n),
    account
      ? publicClient.readContract({
          address: account,
          abi: reusableWalletAbi,
          functionName: "nextPermissionId",
          blockNumber: toBlock,
        })
      : Promise.resolve(0n),
    account
      ? publicClient
          .getLogs({ address: USDC, event: authorizationUsed, args: { authorizer: account }, fromBlock: FROM_BLOCK, toBlock })
          .then(logs => new Set(logs.map(log => log.args.nonce!.toLowerCase())))
      : Promise.resolve(new Set<string>()),
  ]);

  const permissions = account
    ? await Promise.all(
        Array.from({ length: Number(permissionCount) }, (_, i) =>
          publicClient.readContract({
            address: account,
            abi: reusableWalletAbi,
            functionName: "permissions",
            args: [BigInt(i)],
            blockNumber: toBlock,
          }),
        ),
      )
    : [];

  await timestamps([
    ...missionLogs.map(log => log.blockNumber),
    ...missionEvents.map(log => log.blockNumber),
    ...accountEvents.map(log => log.blockNumber),
  ]);

  const payments = new Map<Hex, PaymentState>();
  let pendingUsdc = 0n;
  await Promise.all(
    accountEvents.map(async log => {
      if (log.eventName !== "PaymentApproved") return;
      if (settled.has(log.args.nonce!.toLowerCase())) return payments.set(log.transactionHash, "settled");
      const expiresAt = Number(permissions[Number(log.args.permissionId)]?.[4] ?? 0n);
      const until = await settleableUntil(account!, log.transactionHash, expiresAt);
      // EIP-3009 settles only while block.timestamp < validBefore.
      if (now < until) {
        payments.set(log.transactionHash, "pending");
        pendingUsdc += log.args.amount!;
      } else {
        payments.set(log.transactionHash, "lapsed");
      }
    }),
  );

  const cards: Card[] = [];
  const activity: Activity[] = [];
  const targetOf = new Map<string, Address>();

  missionLogs.forEach((log, i) => {
    const { agent, wallet, allowedTarget, maxSpend, expiresAt } = log.args;
    const [used, cancelled, balance] = missionFlags[i];
    const id = cardId(wallet!);
    const spent = missionEvents
      .filter(e => e.eventName === "Executed" && e.address.toLowerCase() === id)
      .reduce((sum, e) => sum + (e.eventName === "Executed" ? e.args.value! : 0n), 0n);
    const base = {
      id,
      kind: "one-time" as const,
      wallet: wallet!,
      agent: agent!,
      merchant: allowedTarget!,
      maxSpend: maxSpend!,
      spent,
      maxUses: 1,
      uses: used ? 1 : 0,
      expiresAt: Number(expiresAt),
      issuedAt: at(log.blockNumber),
      cancelled,
      balance,
    };
    cards.push({ ...base, status: status(base, now) });
    targetOf.set(id, allowedTarget!);
    activity.push({
      id: `${log.transactionHash}-${log.logIndex}`,
      kind: "issued",
      cardId: id,
      at: at(log.blockNumber),
      block: log.blockNumber,
      position: order(log.transactionIndex, log.logIndex),
      hash: log.transactionHash,
      value: maxSpend,
    });
  });

  const hook = approvalHook();
  const thresholds = new Map<bigint, { threshold: bigint; by: "passkey" | "owner"; publicKey?: Hex }>();
  if (hook) {
    for (const e of accountEvents) {
      if (e.eventName !== "HookAttached" || e.args.hook!.toLowerCase() !== hook.toLowerCase()) continue;
      const [threshold] = decodeAbiParameters([{ type: "uint256" }], slice(e.args.config!, 0, 32));
      // A passkey config also carries the key and RP ID hash: 4 words instead of 1.
      const passkey = e.args.config!.length > 66;
      thresholds.set(e.args.permissionId!, {
        threshold,
        by: passkey ? "passkey" : "owner",
        publicKey: passkey ? slice(e.args.config!, 32, 96) : undefined,
      });
    }
  }

  if (account) {
    const created = accountEvents.filter(e => e.eventName === "PermissionCreated");
    permissions.forEach(([agent, allowedTarget, maxSpend, spent, expiresAt, maxUses, uses, revoked, asset], i) => {
      const id = cardId(account, BigInt(i));
      const log = created.find(e => e.eventName === "PermissionCreated" && e.args.permissionId === BigInt(i));
      const base = {
        id,
        kind: "multi-use" as const,
        wallet: account,
        permissionId: BigInt(i),
        agent,
        merchant: allowedTarget,
        asset: asset === zeroAddress ? undefined : asset,
        maxSpend,
        spent,
        maxUses,
        uses,
        expiresAt: Number(expiresAt),
        issuedAt: log ? at(log.blockNumber) : 0,
        cancelled: revoked,
        balance: 0n,
        approvalThreshold: thresholds.get(BigInt(i))?.threshold,
        approvalBy: thresholds.get(BigInt(i))?.by,
        approvalPublicKey: thresholds.get(BigInt(i))?.publicKey,
      };
      cards.push({ ...base, status: status(base, now) });
      targetOf.set(id, allowedTarget);
    });
  }

  for (const log of missionEvents) {
    const id = cardId(log.address);
    const common = {
      id: `${log.transactionHash}-${log.logIndex}`,
      cardId: id,
      at: at(log.blockNumber),
      block: log.blockNumber,
      position: order(log.transactionIndex, log.logIndex),
      hash: log.transactionHash,
    };
    if (log.eventName === "Executed") {
      activity.push({
        ...common,
        kind: "purchase",
        value: log.args.value,
        memo: log.args.memo,
        summary: describePurchase(merchants, log.args.target!, log.args.data!),
      });
    } else if (log.eventName === "Cancelled") {
      activity.push({ ...common, kind: "cancelled", value: log.args.refunded });
    } else if (log.eventName === "Reclaimed" && log.args.amount! > 0n) {
      activity.push({ ...common, kind: "refund", value: log.args.amount });
    }
  }

  for (const log of accountEvents) {
    const common = {
      id: `${log.transactionHash}-${log.logIndex}`,
      at: at(log.blockNumber),
      block: log.blockNumber,
      position: order(log.transactionIndex, log.logIndex),
      hash: log.transactionHash,
    };
    if (log.eventName === "PermissionCreated") {
      const asset = permissions[Number(log.args.permissionId)]?.[8];
      activity.push({
        ...common,
        kind: "issued",
        cardId: cardId(account!, log.args.permissionId),
        value: log.args.maxSpend,
        asset: asset && asset !== zeroAddress ? asset : undefined,
      });
    } else if (log.eventName === "PaymentApproved") {
      // An x402 card's purchase: the card approved this exact USDC payment, which the seller then settles (or not).
      const asset = permissions[Number(log.args.permissionId)]?.[8];
      activity.push({
        ...common,
        kind: "purchase",
        cardId: cardId(account!, log.args.permissionId),
        value: log.args.amount,
        asset: asset && asset !== zeroAddress ? asset : undefined,
        summary: describePayment(merchants, log.args.payTo!, log.args.amount!),
        payment: payments.get(log.transactionHash),
      });
    } else if (log.eventName === "Executed") {
      activity.push({
        ...common,
        kind: "purchase",
        cardId: cardId(account!, log.args.permissionId),
        value: log.args.value,
        memo: log.args.memo,
        summary: describePurchase(merchants, log.args.target!, log.args.data!),
      });
    } else if (log.eventName === "PermissionRevoked") {
      activity.push({ ...common, kind: "cancelled", cardId: cardId(account!, log.args.permissionId) });
    }
  }

  const blocked = await scanBlocked(
    toBlock,
    new Set(missionWallets.map(w => w.toLowerCase())),
    account,
    merchants,
    targetOf,
  );
  activity.push(...(await withApprovals(blocked, activity, account, toBlock)));

  activity.sort((a, b) => (a.block === b.block ? b.position - a.position : a.block > b.block ? -1 : 1));
  cards.sort((a, b) => {
    const rank = (c: Card) => (c.status === "active" ? 0 : 1);
    return rank(a) - rank(b) || b.issuedAt - a.issuedAt;
  });

  return {
    owner,
    account: account ? { address: account, balance: accountBalance, usdc: accountUsdc, pendingUsdc } : null,
    cards,
    activity,
  };
}

/**
 * Works out where each held purchase's approval stands from the plugin's events, and adds an "approved" row per
 * approval. Done on every snapshot: the blocked scan is cached per block, but approvals arrive later.
 */
async function withApprovals(
  blocked: Activity[],
  activity: Activity[],
  account: Address | null,
  toBlock: bigint,
): Promise<Activity[]> {
  const hook = approvalHook();
  if (!hook || !account || !blocked.some(b => b.held)) return blocked;

  // The chain's "now" (the pending block's time), not this computer's clock: held rows carry block times, and a
  // local chain's time can be moved ahead (evm_increaseTime) or sit idle without new blocks.
  const now = Number((await publicClient.getBlock({ blockTag: "pending" })).timestamp);

  const events = await publicClient.getContractEvents({
    address: hook,
    abi: approvalHookAbi,
    args: { wallet: account },
    fromBlock: FROM_BLOCK,
    toBlock,
  });
  await timestamps(events.map(e => e.blockNumber));

  const after = (e: { blockNumber: bigint; transactionIndex: number }, item: Activity) =>
    e.blockNumber > item.block || (e.blockNumber === item.block && order(e.transactionIndex) > item.position);

  const shown = new Set<string>();
  return blocked.map(item => {
    if (!item.held) return item;
    const approval = events.find(e => e.eventName === "Approved" && e.args.requestKey === item.held!.requestKey && after(e, item));
    if (!approval || approval.eventName !== "Approved") {
      return now - item.at > APPROVAL_WAIT_SECONDS ? { ...item, held: { ...item.held, state: "timed-out" as const } } : item;
    }

    const id = `${approval.transactionHash}-${approval.logIndex}`;
    if (!shown.has(id)) {
      shown.add(id);
      activity.push({
        id,
        kind: "approved",
        cardId: item.cardId,
        at: at(approval.blockNumber),
        block: approval.blockNumber,
        position: order(approval.transactionIndex, approval.logIndex),
        hash: approval.transactionHash,
        value: item.value,
        summary: item.summary,
      });
    }
    // Only a use after this approval counts; an earlier or later approval cycle of the same request doesn't.
    const afterApproval = (e: (typeof events)[number]) =>
      e.blockNumber > approval.blockNumber || (e.blockNumber === approval.blockNumber && e.logIndex > approval.logIndex);
    const used = events.some(e => e.eventName === "ApprovalUsed" && e.args.requestKey === item.held!.requestKey && afterApproval(e));
    const state = used ? "used" : Number(approval.args.validUntil) < now ? "expired" : "approved";
    return { ...item, held: { ...item.held, state } };
  });
}
