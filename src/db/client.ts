import { MongoClient, type Db } from "mongodb";
import dns from "node:dns";
import { resolveMongoUri } from "./resolve-uri";

// Bun's c-ares SRV resolution hangs for Atlas hosts on Vercel
// (oven-sh/bun#25718); public resolvers make `mongodb+srv` lookups work.
// Local Windows dev uses the nslookup fallback in resolve-uri instead.
if (process.env.VERCEL) {
  dns.setServers(["1.1.1.1", "8.8.8.8"]);
}

const dbName = process.env.MONGODB_DB ?? "ledger";

let client: MongoClient | null = null;
let db: Db | null = null;
let connecting: Promise<Db> | null = null;

const CONNECT_TIMEOUT_MS = 12_000;

async function openClient(uri: string): Promise<Db> {
  const resolved = await resolveMongoUri(uri);
  if (resolved !== uri) {
    console.log("Resolved mongodb+srv URI to direct connection (Bun DNS workaround).");
  }

  const next = new MongoClient(resolved, {
    serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS,
    connectTimeoutMS: CONNECT_TIMEOUT_MS,
    /* The driver default (100) times however many isolates Vercel spins up
       under load can exceed a small Atlas tier's connection cap, surfacing
       as intermittent 503s. Serverless functions serve requests one at a
       time per isolate anyway, so a small pool is plenty. */
    maxPoolSize: 10,
    maxIdleTimeMS: 30_000,
  });
  await next.connect();
  client = next;
  return client.db(dbName);
}

export async function connectDb(): Promise<Db> {
  if (db) return db;
  if (connecting) return connecting;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set. Add it to your .env file.");
  }

  connecting = (async () => {
    try {
      const nextDb = await openClient(uri);
      /* Indexes sync at build time (`bun run db:indexes`) instead of here —
         see ensureIndexes' doc comment. */
      db = nextDb;
      return db;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Could not connect to MongoDB: ${message}`, { cause: err });
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}

export function isDbConnected(): boolean {
  return db !== null;
}

export function getDb(): Db {
  if (!db) {
    throw new Error("Database not connected. Call connectDb() before handling requests.");
  }
  return db;
}

/**
 * Test helper: point the module singleton at an in-memory (or other) Db.
 * Pass `null` to clear. Production code should use connectDb() instead.
 */
export function setDbForTests(next: Db | null): void {
  db = next;
  if (!next) {
    client = null;
    connecting = null;
  }
}
