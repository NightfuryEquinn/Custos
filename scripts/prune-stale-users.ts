/**
 * Remove users inactive for over ACCOUNT_STALE_DAYS and all their owned data.
 *
 * Activity is users.lastSeenAt (set on login / session renew). Falls back to
 * max(sessions.lastSeenAt) then users.createdAt when lastSeenAt is missing.
 *
 * Usage:
 *   bun scripts/prune-stale-users.ts --dry-run
 *   bun scripts/prune-stale-users.ts --yes
 *
 * Requires MONGODB_URI (and optional MONGODB_DB) from the environment / .env.
 */

import type { Db } from "mongodb";
import { ACCOUNT_STALE_DAYS, ACCOUNT_STALE_MS } from "../src/lib/account-retention";
import { COLLECTIONS } from "../src/db/collections";
import { fail, withDb } from "./lib/mongo";
import { addressMatch, formatCounts, purgeAccount } from "./lib/purge-account";

/** Print CLI help. */
function printHelp(): void {
  console.log(`Prune users inactive for over ${ACCOUNT_STALE_DAYS} days (and their data).

Usage:
  bun scripts/prune-stale-users.ts --dry-run
  bun scripts/prune-stale-users.ts --yes
  bun scripts/prune-stale-users.ts --help

Options:
  --dry-run     List stale accounts and document counts; do not delete
  --yes, -y     Skip the confirmation prompt
  --help, -h    Show this help
`);
}

/** Confirm a destructive action via stdin. */
async function confirm(message: string): Promise<boolean> {
  process.stdout.write(`${message} [y/N] `);

  for await (const line of console) {
    const answer = String(line).trim().toLowerCase();

    return answer === "y" || answer === "yes";
  }

  return false;
}

/** Resolve the best-known last activity timestamp for a user. */
async function resolveLastActivity(
  db: Db,
  accountId: string,
  address: string | undefined,
  createdAt: Date,
  lastSeenAt: Date | undefined,
): Promise<Date> {
  if (lastSeenAt instanceof Date && !Number.isNaN(lastSeenAt.getTime())) {
    return lastSeenAt;
  }

  const sessions = db.collection(COLLECTIONS.sessions);
  const byAccount = await sessions
    .find({ accountId })
    .project({ lastSeenAt: 1 })
    .sort({ lastSeenAt: -1 })
    .limit(1)
    .next();

  if (byAccount?.lastSeenAt instanceof Date) {
    return byAccount.lastSeenAt;
  }

  if (address) {
    const byAddress = await sessions
      .find({ address: addressMatch(address) })
      .project({ lastSeenAt: 1 })
      .sort({ lastSeenAt: -1 })
      .limit(1)
      .next();

    if (byAddress?.lastSeenAt instanceof Date) {
      return byAddress.lastSeenAt;
    }
  }

  return createdAt instanceof Date ? createdAt : new Date(0);
}

/** Run the stale-user prune (or dry-run). */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();

    return;
  }

  const dryRun = args.includes("--dry-run");
  const yes = args.includes("--yes") || args.includes("-y");

  if (!dryRun && !yes && args.filter((a) => !a.startsWith("-")).length) {
    console.error("Unknown arguments. Use --help for usage.");
    process.exit(1);
  }

  const cutoff = new Date(Date.now() - ACCOUNT_STALE_MS);

  await withDb(async (db, dbName) => {
    const users = db.collection(COLLECTIONS.users);
    const cursor = users.find({}, { projection: { address: 1, createdAt: 1, lastSeenAt: 1 } });

    const stale: Array<{
      accountId: string;
      address: string | undefined;
      lastActivity: Date;
    }> = [];

    for await (const user of cursor) {
      const accountId = user._id.toHexString();
      const address = typeof user.address === "string" ? user.address : undefined;
      const createdAt = user.createdAt instanceof Date ? user.createdAt : new Date(0);
      const lastSeenAt = user.lastSeenAt instanceof Date ? user.lastSeenAt : undefined;
      const lastActivity = await resolveLastActivity(db, accountId, address, createdAt, lastSeenAt);

      if (lastActivity.getTime() < cutoff.getTime()) {
        stale.push({ accountId, address, lastActivity });
      }
    }

    console.log(`Database: ${dbName}`);
    console.log(`Cutoff:   ${cutoff.toISOString()} (${ACCOUNT_STALE_DAYS} days)`);
    console.log(`Stale:    ${stale.length} account(s)`);

    if (!stale.length) {
      console.log("Nothing to prune.");

      return;
    }

    if (!dryRun && !yes) {
      const ok = await confirm(`Delete ${stale.length} stale account(s) and all their data?`);

      if (!ok) {
        console.log("Aborted.");
        process.exit(1);
      }
    }

    let purged = 0;

    for (const row of stale) {
      const counts = await purgeAccount(db, {
        accountId: row.accountId,
        address: row.address,
        dryRun,
      });
      purged++;
      const label = row.address ?? row.accountId;
      const prefix = dryRun ? "[dry-run]" : "purged";
      console.log(
        `${prefix} ${label} lastActivity=${row.lastActivity.toISOString()} ${formatCounts(counts)}`,
      );
    }

    console.log(`Done. accounts=${purged}${dryRun ? " (dry-run)" : ""}`);
  });
}

main().catch(fail);
