import { decodeFunctionData, zeroAddress, type Address, type Hex } from "viem";
import {
  merchantAbi,
  missionFactoryAbi,
  missionWalletAbi,
  reusableFactoryAbi,
  reusableWalletAbi,
} from "@shared/abis";
import { decodePurchase, describeRevert, revertData } from "@shared/revert";
import { publicClient } from "./chain";
import { contracts } from "./config";

export type Merchant = { address: Address; name: string; items: readonly { name: string; price: bigint }[] };

export type CardKind = "one-time" | "multi-use";
export type CardStatus = "active" | "used" | "expired" | "cancelled";

export type Card = {
  id: string;
  kind: CardKind;
  wallet: Address;
  permissionId?: bigint;
  agent: Address;
  merchant: Address;
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
};

export type ActivityKind = "issued" | "purchase" | "blocked" | "cancelled" | "refund";

export type Activity = {
  id: string;
  kind: ActivityKind;
  cardId: string;
  at: number;
  block: bigint;
  position: number;
  hash: Hex;
  value?: bigint;
  memo?: string;
  summary?: string;
  reason?: string;
};

export type Account = { address: Address; balance: bigint };

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
  return Promise.all(
    contracts().merchants.map(async address => {
      const [name, items] = await Promise.all([
        publicClient.readContract({ address, abi: merchantAbi, functionName: "name" }),
        publicClient.readContract({ address, abi: merchantAbi, functionName: "items" }),
      ]);
      return { address, name, items };
    }),
  );
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
const scan: BlockedScan = { chainStart: undefined, scannedTo: -1n, found: [] };

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
      let value: bigint;
      let data: Hex;
      let memo: string;
      try {
        if (isMission) {
          const call = decodeFunctionData({ abi: missionWalletAbi, data: tx.input });
          if (call.functionName !== "execute") continue;
          [, value, data, memo] = call.args;
          id = cardId(tx.to!);
        } else {
          const call = decodeFunctionData({ abi: reusableWalletAbi, data: tx.input });
          if (call.functionName !== "execute") continue;
          const [permissionId] = call.args;
          [, , value, data, memo] = call.args;
          id = cardId(tx.to!, permissionId);
        }
      } catch {
        continue;
      }

      const merchant = targetOf.get(id);
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
        reason: describeRevert(await revertData(publicClient.request, tx.hash)),
      });
    }
  }
  scan.scannedTo = toBlock;
  return scan.found;
}

async function resetIfChainRestarted(toBlock: bigint) {
  const genesis = (await publicClient.getBlock({ blockNumber: 0n })).hash;
  if (scan.chainStart !== genesis || toBlock < scan.scannedTo) {
    scan.chainStart = genesis;
    scan.scannedTo = -1n;
    scan.found = [];
    blockTimes.clear();
  }
}

// Orders activity within a block: by transaction, then by log inside it.
const order = (transactionIndex: number, logIndex = 0) => transactionIndex * 10_000 + logIndex;

export async function fetchSnapshot(owner: Address, merchants: Merchant[]): Promise<Snapshot> {
  const { missionFactory, reusableFactory } = contracts();
  const toBlock = await publicClient.getBlockNumber();
  await resetIfChainRestarted(toBlock);
  const now = Date.now() / 1000;

  const [missionLogs, accountAddress] = await Promise.all([
    publicClient.getContractEvents({
      address: missionFactory,
      abi: missionFactoryAbi,
      eventName: "MissionCreated",
      args: { owner },
      fromBlock: 0n,
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

  const [missionEvents, missionFlags, accountEvents, accountBalance, permissionCount] = await Promise.all([
    missionWallets.length
      ? publicClient.getContractEvents({ address: missionWallets, abi: missionWalletAbi, fromBlock: 0n, toBlock })
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
      ? publicClient.getContractEvents({ address: account, abi: reusableWalletAbi, fromBlock: 0n, toBlock })
      : Promise.resolve([]),
    account ? publicClient.getBalance({ address: account, blockNumber: toBlock }) : Promise.resolve(0n),
    account
      ? publicClient.readContract({
          address: account,
          abi: reusableWalletAbi,
          functionName: "nextPermissionId",
          blockNumber: toBlock,
        })
      : Promise.resolve(0n),
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

  if (account) {
    const created = accountEvents.filter(e => e.eventName === "PermissionCreated");
    permissions.forEach(([agent, allowedTarget, maxSpend, spent, expiresAt, maxUses, uses, revoked], i) => {
      const id = cardId(account, BigInt(i));
      const log = created.find(e => e.eventName === "PermissionCreated" && e.args.permissionId === BigInt(i));
      const base = {
        id,
        kind: "multi-use" as const,
        wallet: account,
        permissionId: BigInt(i),
        agent,
        merchant: allowedTarget,
        maxSpend,
        spent,
        maxUses,
        uses,
        expiresAt: Number(expiresAt),
        issuedAt: log ? at(log.blockNumber) : 0,
        cancelled: revoked,
        balance: 0n,
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
      activity.push({
        ...common,
        kind: "issued",
        cardId: cardId(account!, log.args.permissionId),
        value: log.args.maxSpend,
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
  activity.push(...blocked);

  activity.sort((a, b) => (a.block === b.block ? b.position - a.position : a.block > b.block ? -1 : 1));
  cards.sort((a, b) => {
    const rank = (c: Card) => (c.status === "active" ? 0 : 1);
    return rank(a) - rank(b) || b.issuedAt - a.issuedAt;
  });

  return {
    owner,
    account: account ? { address: account, balance: accountBalance } : null,
    cards,
    activity,
  };
}
