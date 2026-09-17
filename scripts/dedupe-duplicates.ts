/**
 * Find (and optionally fix) the duplicate rows that motivated making three
 * indexes unique in src/db/indexes.ts:
 *   - financialWallets: two rows racing migrateLegacyData/saveWallet both
 *     flagged isDefault for the same account.
 *   - expenses: two rows for the same recurring series + date, produced by
 *     an overlapping cron run (processDueRecurringExpenses) or a
 *     double-submitted create before the ref-guard fix.
 *
 * Run this BEFORE deploying the unique-index change — `bun run db:indexes`
 * fails outright if duplicates still exist. Report-only by default.
 *
 * Fixing a wallet duplicate flips the extra isDefault flags to false; it
 * never deletes a wallet (it may hold real transactions). Fixing an expense
 * duplicate DELETES the extra row(s), keeping the earliest by createdAt
 * (tiebreak: lowest _id) — this is only safe because the whole point of the
 * dedupe indexes is that these rows are exact duplicates (same series, same
 * date), not merely similar.
 *
 * Usage:
 *   bun scripts/dedupe-duplicates.ts               # report only
 *   bun scripts/dedupe-duplicates.ts --yes         # fix what was found
 *
 * Requires MONGODB_URI (and optional MONGODB_DB) from the environment / .env.
 */

import { MongoClient, ObjectId, type Db } from "mongodb";
import { COLLECTIONS } from "../src/db/collections";
import { resolveMongoUri } from "../src/db/resolve-uri";

function printHelp(): void {
  console.log(`Find/fix duplicate wallets and recurring-expense occurrences.

Usage:
  bun scripts/dedupe-duplicates.ts           Report only (default)
  bun scripts/dedupe-duplicates.ts --yes     Apply fixes
  bun scripts/dedupe-duplicates.ts --help
`);
}

/** Confirm a destructive action via stdin. */
async function confirm(message: string): Promise<boolean> {
  process.stdout.write(`${message} [y/N] `);
  for await (const line of console) {
    return String(line).trim().toLowerCase() === "y";
  }
  return false;
}

type WalletDupGroup = {
  accountId: string;
  ids: ObjectId[];
  createdAts: Date[];
};

/** Accounts with more than one wallet flagged isDefault. */
async function findWalletDuplicates(db: Db): Promise<WalletDupGroup[]> {
  const rows = await db
    .collection(COLLECTIONS.financialWallets)
    .aggregate<{ _id: string; ids: ObjectId[]; createdAts: Date[] }>([
      { $match: { isDefault: true } },
      {
        $group: { _id: "$accountId", ids: { $push: "$_id" }, createdAts: { $push: "$createdAt" } },
      },
      { $match: { $expr: { $gt: [{ $size: "$ids" }, 1] } } },
    ])
    .toArray();

  return rows.map((r) => ({ accountId: r._id, ids: r.ids, createdAts: r.createdAts }));
}

/** Flip every wallet but the earliest-created one to isDefault: false. */
async function fixWalletDuplicates(db: Db, groups: WalletDupGroup[]): Promise<number> {
  const col = db.collection(COLLECTIONS.financialWallets);
  let fixed = 0;
  for (const group of groups) {
    const paired = group.ids
      .map((id, i) => ({ id, createdAt: group.createdAts[i] ?? new Date(0) }))
      .sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.toString().localeCompare(b.id.toString()),
      );
    const [keep, ...drop] = paired;
    if (!keep || !drop.length) continue;
    await col.updateMany({ _id: { $in: drop.map((d) => d.id) } }, { $set: { isDefault: false } });
    fixed += drop.length;
  }
  return fixed;
}

type ExpenseDupGroup = {
  key: string;
  ids: ObjectId[];
  createdAts: Date[];
};

/** Group key: legacy plaintext series (accountId, walletId, sub, note, recurring, date). */
async function findLegacyExpenseDuplicates(db: Db): Promise<ExpenseDupGroup[]> {
  const rows = await db
    .collection(COLLECTIONS.expenses)
    .aggregate<{ _id: unknown; ids: ObjectId[]; createdAts: Date[] }>([
      {
        $match: {
          recurring: { $in: [true, "monthly", "quarterly", "yearly"] },
          walletId: { $exists: true },
          enc: { $ne: 1 },
        },
      },
      {
        $group: {
          _id: {
            accountId: "$accountId",
            walletId: "$walletId",
            sub: "$sub",
            note: "$note",
            recurring: "$recurring",
            date: "$date",
          },
          ids: { $push: "$_id" },
          createdAts: { $push: "$createdAt" },
        },
      },
      { $match: { $expr: { $gt: [{ $size: "$ids" }, 1] } } },
    ])
    .toArray();

  return rows.map((r) => ({ key: JSON.stringify(r._id), ids: r.ids, createdAts: r.createdAts }));
}

/** Group key: encrypted series (accountId, walletId, seriesKey, recurring, date). */
async function findEncryptedExpenseDuplicates(db: Db): Promise<ExpenseDupGroup[]> {
  const rows = await db
    .collection(COLLECTIONS.expenses)
    .aggregate<{ _id: unknown; ids: ObjectId[]; createdAts: Date[] }>([
      {
        $match: {
          recurring: { $in: [true, "monthly", "quarterly", "yearly"] },
          walletId: { $exists: true },
          enc: 1,
          seriesKey: { $exists: true },
        },
      },
      {
        $group: {
          _id: {
            accountId: "$accountId",
            walletId: "$walletId",
            seriesKey: "$seriesKey",
            recurring: "$recurring",
            date: "$date",
          },
          ids: { $push: "$_id" },
          createdAts: { $push: "$createdAt" },
        },
      },
      { $match: { $expr: { $gt: [{ $size: "$ids" }, 1] } } },
    ])
    .toArray();

  return rows.map((r) => ({ key: JSON.stringify(r._id), ids: r.ids, createdAts: r.createdAts }));
}

/** Delete every row in each group but the earliest-created one. */
async function fixExpenseDuplicates(db: Db, groups: ExpenseDupGroup[]): Promise<number> {
  const col = db.collection(COLLECTIONS.expenses);
  let deleted = 0;
  for (const group of groups) {
    const paired = group.ids
      .map((id, i) => ({ id, createdAt: group.createdAts[i] ?? new Date(0) }))
      .sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.toString().localeCompare(b.id.toString()),
      );
    const [, ...drop] = paired;
    if (!drop.length) continue;
    await col.deleteMany({ _id: { $in: drop.map((d) => d.id) } });
    deleted += drop.length;
  }
  return deleted;
}

function msSpread(dates: Date[]): number {
  const times = dates.map((d) => d.getTime());
  return Math.max(...times) - Math.min(...times);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  const yes = args.includes("--yes") || args.includes("-y");

  const rawUri = process.env.MONGODB_URI;
  if (!rawUri) throw new Error("MONGODB_URI is not set. Add it to your .env file.");

  const uri = await resolveMongoUri(rawUri);
  const dbName = process.env.MONGODB_DB?.trim() || "ledger";
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 15_000,
    connectTimeoutMS: 15_000,
  });

  try {
    await client.connect();
    const db = client.db(dbName);

    const walletDups = await findWalletDuplicates(db);
    const legacyDups = await findLegacyExpenseDuplicates(db);
    const encryptedDups = await findEncryptedExpenseDuplicates(db);

    console.log(`Database: ${dbName}`);
    console.log(`Duplicate default-wallet groups: ${walletDups.length}`);
    for (const g of walletDups) {
      console.log(
        `  account=${g.accountId} wallets=${g.ids.length} createdAt spread=${msSpread(g.createdAts)}ms`,
      );
    }
    console.log(`Duplicate legacy recurring occurrences: ${legacyDups.length}`);
    console.log(`Duplicate encrypted recurring occurrences: ${encryptedDups.length}`);
    for (const g of [...legacyDups, ...encryptedDups]) {
      console.log(`  ${g.key} rows=${g.ids.length} createdAt spread=${msSpread(g.createdAts)}ms`);
    }

    const total = walletDups.length + legacyDups.length + encryptedDups.length;
    if (!total) {
      console.log("Nothing to fix. Safe to deploy the unique-index change.");
      return;
    }

    if (!yes) {
      console.log("\nDry run — no changes made. Re-run with --yes to apply fixes.");
      return;
    }

    const ok = await confirm(
      `Fix ${walletDups.length} wallet group(s) (flip isDefault) and delete duplicates from ${legacyDups.length + encryptedDups.length} expense group(s)?`,
    );
    if (!ok) {
      console.log("Aborted.");
      process.exitCode = 1;
      return;
    }

    const walletsFixed = await fixWalletDuplicates(db, walletDups);
    const expensesDeleted = await fixExpenseDuplicates(db, [...legacyDups, ...encryptedDups]);
    console.log(
      `Fixed: ${walletsFixed} wallet(s) un-defaulted, ${expensesDeleted} expense row(s) deleted.`,
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("Failed:", message);
  process.exit(1);
});
