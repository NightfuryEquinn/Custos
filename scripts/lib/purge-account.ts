/**
 * Shared Mongo purge for one opaque accountId (users._id hex).
 * Used by prune-stale-users and wipe-account.
 */

import { ObjectId, type Db } from "mongodb";
import { COLLECTIONS } from "../../src/db/collections";

/** Collections keyed by opaque accountId. */
export const OWNED_BY_ACCOUNT_ID = [
  COLLECTIONS.ledgerProfiles,
  COLLECTIONS.financialWallets,
  COLLECTIONS.categoryTaxonomies,
  COLLECTIONS.expenses,
  COLLECTIONS.events,
  COLLECTIONS.todoLists,
  COLLECTIONS.capitalPlans,
  COLLECTIONS.vehicles,
  COLLECTIONS.vehicleFills,
  COLLECTIONS.dailyRoutines,
  COLLECTIONS.dailyCompletions,
  COLLECTIONS.consent,
  COLLECTIONS.budgetAlertLogs,
  COLLECTIONS.reminderLogs,
  COLLECTIONS.pushSubscriptions,
  COLLECTIONS.sessions,
] as const;

export type DeleteCounts = Record<string, number>;

/** Escape a string for safe use inside a RegExp. */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive exact match for a wallet address field. */
export function addressMatch(address: string) {
  return { $regex: `^${escapeRegex(address)}$`, $options: "i" };
}

/** Delete (or count) all data owned by one account. */
export async function purgeAccount(
  db: Db,
  opts: {
    accountId: string;
    address: string | undefined;
    dryRun: boolean;
  },
): Promise<DeleteCounts> {
  const { accountId, address, dryRun } = opts;
  const counts: DeleteCounts = {};

  const events = await db
    .collection(COLLECTIONS.events)
    .find({ accountId })
    .project({ _id: 1 })
    .toArray();
  const eventIds = events.map((ev) => ev._id);

  if (eventIds.length) {
    const filter = { eventId: { $in: eventIds } };

    if (dryRun) {
      counts[COLLECTIONS.reminderLogs] = await db
        .collection(COLLECTIONS.reminderLogs)
        .countDocuments(filter);
    } else {
      const result = await db.collection(COLLECTIONS.reminderLogs).deleteMany(filter);
      counts[COLLECTIONS.reminderLogs] = result.deletedCount;
    }
  }

  for (const name of OWNED_BY_ACCOUNT_ID) {
    const filter = { accountId };

    if (dryRun) {
      counts[name] = await db.collection(name).countDocuments(filter);
    } else {
      const result = await db.collection(name).deleteMany(filter);
      counts[name] = result.deletedCount;
    }
  }

  /* Legacy sessions that still key by address only. */
  if (address) {
    const legacySessionFilter = {
      address: addressMatch(address),
      accountId: { $exists: false },
    };

    if (dryRun) {
      counts["sessions(legacy)"] = await db
        .collection(COLLECTIONS.sessions)
        .countDocuments(legacySessionFilter);
    } else {
      const result = await db.collection(COLLECTIONS.sessions).deleteMany(legacySessionFilter);
      counts["sessions(legacy)"] = result.deletedCount;
    }

    const nonceFilter = { address: addressMatch(address) };

    if (dryRun) {
      counts[COLLECTIONS.authNonces] = await db
        .collection(COLLECTIONS.authNonces)
        .countDocuments(nonceFilter);
    } else {
      const result = await db.collection(COLLECTIONS.authNonces).deleteMany(nonceFilter);
      counts[COLLECTIONS.authNonces] = result.deletedCount;
    }
  }

  const userFilter = { _id: new ObjectId(accountId) };

  if (dryRun) {
    counts[COLLECTIONS.users] = await db.collection(COLLECTIONS.users).countDocuments(userFilter);
  } else {
    const result = await db.collection(COLLECTIONS.users).deleteOne(userFilter);
    counts[COLLECTIONS.users] = result.deletedCount;
  }

  return counts;
}

/** Format a counts map as a compact summary string. */
export function formatCounts(counts: DeleteCounts): string {
  return (
    Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([name, n]) => `${name}=${n}`)
      .join(" ") || "(no docs)"
  );
}
