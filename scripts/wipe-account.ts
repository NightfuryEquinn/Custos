/**
 * Wipe all MongoDB data for one accountId (users._id hex).
 *
 * Usage:
 *   bun scripts/wipe-account.ts --account-id <hex> --dry-run
 *   bun scripts/wipe-account.ts --account-id <hex> --yes
 *   bun scripts/wipe-account.ts --account-id <hex> --force --yes
 *
 * Requires MONGODB_URI (and optional MONGODB_DB) from the environment / .env.
 */

import { ObjectId } from "mongodb";
import { COLLECTIONS } from "../src/db/collections";
import { fail, withDb } from "./lib/mongo";
import { formatCounts, purgeAccount } from "./lib/purge-account";

/** Print CLI help. */
function printHelp(): void {
  console.log(`Wipe all MongoDB data for one accountId.

Usage:
  bun scripts/wipe-account.ts --account-id <hex> --dry-run
  bun scripts/wipe-account.ts --account-id <hex> --yes
  bun scripts/wipe-account.ts --account-id <hex> --force --yes

Options:
  --account-id <hex>   users._id as 24-char hex (required)
  --dry-run            Print per-collection counts; do not delete
  --yes, -y            Required to delete (without it, only --dry-run runs)
  --force             Allow wipe when the users row is already missing
  --help, -h           Show this help
`);
}

/** Read a required --flag value from argv. */
function flagValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);

  if (idx < 0) return undefined;

  return args[idx + 1];
}

/** Run the targeted account wipe (or dry-run). */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (!args.length || args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(args.length ? 0 : 1);
  }

  const accountId = flagValue(args, "--account-id");
  const dryRun = args.includes("--dry-run");
  const yes = args.includes("--yes") || args.includes("-y");
  const force = args.includes("--force");

  if (!accountId) {
    console.error("Missing --account-id <hex>. Use --help for usage.");
    process.exit(1);
  }

  if (!ObjectId.isValid(accountId) || String(new ObjectId(accountId)) !== accountId) {
    console.error("Invalid --account-id: expected a 24-character ObjectId hex string.");
    process.exit(1);
  }

  if (!dryRun && !yes) {
    console.error("Refusing to delete without --yes (or pass --dry-run).");
    process.exit(1);
  }

  await withDb(async (db, dbName) => {
    const user = await db
      .collection(COLLECTIONS.users)
      .findOne({ _id: new ObjectId(accountId) }, { projection: { address: 1 } });

    if (!user && !force) {
      console.error(
        `No users document for accountId=${accountId}. Pass --force to wipe orphaned accountId docs.`,
      );
      process.exit(1);
    }

    const address = typeof user?.address === "string" ? user.address : undefined;

    console.log(`Database:  ${dbName}`);
    console.log(`Account:   ${accountId}`);
    console.log(`Address:   ${address ?? "(none)"}`);
    console.log(`Mode:      ${dryRun ? "dry-run" : "DELETE"}`);

    const counts = await purgeAccount(db, { accountId, address, dryRun });
    const prefix = dryRun ? "[dry-run]" : "wiped";
    console.log(`${prefix} ${formatCounts(counts)}`);
    console.log("Done.");
  });
}

main().catch(fail);
