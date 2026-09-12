/**
 * Sync Mongo indexes for the current schema.
 *
 * Wired into the Vercel build command (see vercel.json) so index setup runs
 * once per deploy instead of inside connectDb() on every cold serverless
 * isolate — see the doc comment on ensureIndexes for why that mattered.
 *
 * Usage:
 *   bun scripts/sync-indexes.ts
 *
 * Requires MONGODB_URI (and optional MONGODB_DB) from the environment.
 */

import { MongoClient } from "mongodb";
import { ensureIndexes } from "../src/db/indexes";
import { resolveMongoUri } from "../src/db/resolve-uri";

async function main(): Promise<void> {
  const rawUri = process.env.MONGODB_URI;

  if (!rawUri) {
    throw new Error("MONGODB_URI is not set.");
  }

  const uri = await resolveMongoUri(rawUri);
  const dbName = process.env.MONGODB_DB?.trim() || "ledger";
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 15_000,
    connectTimeoutMS: 15_000,
  });

  try {
    await client.connect();
    await ensureIndexes(client.db(dbName));
    console.log(`Indexes synced. database=${dbName}`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("Failed:", message);
  process.exit(1);
});
