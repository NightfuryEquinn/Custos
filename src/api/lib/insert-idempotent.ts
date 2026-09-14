import { conflict } from "@/api/lib/errors";
import type { Collection, ObjectId, OptionalUnlessRequiredId } from "mongodb";

type OwnedDoc = { _id: ObjectId; accountId: string };

/**
 * Insert a document whose `_id` may have been minted by the client rather
 * than the server — the offline write queue mints ids up front so a queued
 * create is final the instant the user saves (see src/frontend/lib/sync).
 *
 * A retried insert (the client sent the request, the response was lost, and
 * it replayed the identical POST) is a duplicate-key insert on the same
 * `_id`. Rather than fail it, re-read the document: if it belongs to the
 * same account, the replay is indistinguishable from the original request
 * having landed — return it as success. If it belongs to a different
 * account, return a generic conflict — never revealing whose document it
 * is, and never handing back another account's data. With ids drawn from
 * 96 random bits (mirroring `randomObjectId()`'s own no-embedded-timestamp
 * scheme), a same-account collision this way is what we're guarding for and
 * a foreign collision is a non-event in practice, not a working
 * id-guessing channel.
 */
export async function insertOwned<T extends OwnedDoc>(
  collection: Collection<T>,
  doc: T,
): Promise<{ doc: T; created: boolean }> {
  try {
    await collection.insertOne(doc as OptionalUnlessRequiredId<T>);
    return { doc, created: true };
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;

    const existing = await collection.findOne({ _id: doc._id } as Parameters<
      Collection<T>["findOne"]
    >[0]);
    if (existing && (existing as unknown as OwnedDoc).accountId === doc.accountId) {
      return { doc: existing as unknown as T, created: false };
    }
    conflict("Duplicate id");
  }
}
