/**
 * Shared connection for the db:* scripts: read MONGODB_URI / MONGODB_DB, connect,
 * run `fn`, and always close the client.
 */

import { MongoClient, type Db } from "mongodb";
import { resolveMongoUri } from "../../src/db/resolve-uri";

/** Run `fn` against the configured database; throws if MONGODB_URI is not set. */
export async function withDb<T>(fn: (db: Db, dbName: string) => Promise<T>): Promise<T> {
  const rawUri = process.env.MONGODB_URI;

  if (!rawUri) {
    throw new Error("MONGODB_URI is not set. Add it to your .env file.");
  }

  const uri = await resolveMongoUri(rawUri);
  const dbName = process.env.MONGODB_DB?.trim() || "ledger";
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 15_000,
    connectTimeoutMS: 15_000,
  });

  try {
    await client.connect();

    return await fn(client.db(dbName), dbName);
  } finally {
    await client.close();
  }
}

/** Shared top-level failure handler: print the error (and cause) and exit 1. */
export function fail(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  console.error("Failed:", message);

  if (err instanceof Error && err.cause) {
    console.error("Cause:", err.cause instanceof Error ? err.cause.message : err.cause);
  }

  process.exit(1);
}
