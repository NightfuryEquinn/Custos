/**
 * Grant or revoke the Supporter chip for one wallet address.
 *
 * Usage:
 *   bun run db:grant-supporter 0xABC…            # grant
 *   bun run db:grant-supporter 0xABC… --revoke   # revoke
 *
 * Requires MONGODB_URI (and optional MONGODB_DB) from the environment / .env.
 *
 * Sets `supporterSince` on the user document; the account menu shows a
 * "Since MM/YY" chip beside the codename while it is present. The chip is
 * cosmetic — nothing in the app is gated on it, and the field is not writable
 * through the API.
 *
 * ponytail: manual grant by wallet address. Add a self-serve flow only if
 * supporters outgrow doing this by hand.
 */

import { COLLECTIONS } from "../src/db/collections";
import { fail, withDb } from "./lib/mongo";

function printHelp(): void {
  console.log(`Grant or revoke the Supporter chip for one wallet address.

Usage:
  bun run db:grant-supporter <address>            Grant
  bun run db:grant-supporter <address> --revoke    Revoke

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

  await withDb(async (db) => {
    const users = db.collection(COLLECTIONS.users);
    const lower = address.toLowerCase();

    const now = new Date();
    /* $min sets the field when it is absent and otherwise keeps the earlier date,
       so granting twice does not move the "Since" date forward. */
    const updated = await users.findOneAndUpdate(
      { address: lower },
      revoke
        ? { $unset: { supporterSince: "" }, $set: { updatedAt: now } }
        : { $min: { supporterSince: now }, $set: { updatedAt: now } },
      { returnDocument: "after" },
    );

    if (!updated) {
      console.error(`No user found for address ${address}.`);
      process.exit(1);
    }

    console.log(
      revoke
        ? `Revoked Supporter for ${address}.`
        : `Granted Supporter to ${address} (since ${(updated.supporterSince as Date).toISOString()}).`,
    );
  });
}

main().catch(fail);
