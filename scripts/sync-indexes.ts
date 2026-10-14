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

import { ensureIndexes } from "../src/db/indexes";
import { fail, withDb } from "./lib/mongo";

withDb(async (db, dbName) => {
  await ensureIndexes(db);
  console.log(`Indexes synced. database=${dbName}`);
}).catch(fail);
