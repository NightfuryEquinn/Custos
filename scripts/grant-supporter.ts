/**
 * Grant or revoke the Supporter perk for one wallet address.
 *
 * Usage:
 *   bun scripts/grant-supporter.ts 0xABC…            # grant
 *   bun scripts/grant-supporter.ts 0xABC… --revoke   # revoke
 *
 * Requires MONGODB_URI (and optional MONGODB_DB) from the environment / .env.
 *
 * Lemon Squeezy bills the Supporter perk as a monthly subscription, but the
 * grant here is a one-off, permanent flag with no automatic expiry — a
 * cancelled subscription does not lose the perk on its own; run --revoke
 * by hand if that ever needs to change.
 *
 * ponytail: manual grant, ~24h turnaround after checkout. Upgrade to a
 * provider webhook once the manual step gets annoying — src/api/routes/cron.ts's
 * assertCronAuth is already the right shape (own Hono(), no sessionAuth,
 * ensureDb, timing-safe compare); swap the shared secret for an HMAC over
 * `await c.req.text()` (the codebase only ever uses c.req.json() today, and
 * signature verification needs the raw body).
 */

import { MongoClient } from "mongodb";
import { COLLECTIONS } from "../src/db/collections";
import { resolveMongoUri } from "../src/db/resolve-uri";

function printHelp(): void {
  console.log(`Grant or revoke the Supporter perk for one wallet address.

Usage:
  bun scripts/grant-supporter.ts <address>            Grant
  bun scripts/grant-supporter.ts <address> --revoke    Revoke

Options:
  --help, -h   Show this help
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (!args.length || args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(args.length ? 0 : 1);
  }

  const address = args.find((a) => !a.startsWith("-"));
  const revoke = args.includes("--revoke");

  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    console.error("Expected a wallet address like 0xABC…. Use --help for usage.");
    process.exit(1);
  }

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
    const users = db.collection(COLLECTIONS.users);
    const lower = address.toLowerCase();

    const updated = await users.findOneAndUpdate(
      { address: lower },
      revoke
        ? { $unset: { supporterSince: "" }, $set: { updatedAt: new Date() } }
        : { $set: { supporterSince: new Date(), updatedAt: new Date() } },
      { returnDocument: "after" },
    );

    if (!updated) {
      console.error(`No user found for address ${address}.`);
      process.exit(1);
    }

    console.log(
      revoke
        ? `Revoked Supporter for ${address}.`
        : `Granted Supporter to ${address} at ${(updated.supporterSince as Date).toISOString()}.`,
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
