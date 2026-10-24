/**
 * One-off: replace the plaintext `at` timestamp on Nudge check-ins with the `seq` sort counter.
 *
 * Rows written before `seq` existed keep their order (oldest = lowest) but lose the exact tap
 * time: the server cannot move it into the ciphertext without the key. Legacy rows get negative
 * `seq`, so every new row (revision >= 1) sorts above them. Safe to run again; it only touches
 * rows that still lack `seq`. Also drops the two old `at` indexes.
 *
 * Usage:
 *   bun scripts/migrate-nudge-check-in-at.ts
 *
 * Requires MONGODB_URI (and optional MONGODB_DB) from the environment / .env.
 */

import { COLLECTIONS } from "../src/db/collections";
import { ensureIndexes } from "../src/db/indexes";
import { fail, withDb } from "./lib/mongo";

const OLD_INDEXES = [
  "accountId_1_nudgeId_1_at_-1__id_-1",
  "accountId_1_nudgeId_1_day_1_at_-1__id_-1",
];

withDb(async (db, dbName) => {
  const rows = db.collection(COLLECTIONS.nudgeCheckIns);
  const groups = await rows
    .aggregate<{ _id: { accountId: string; nudgeId: string } }>([
      { $match: { seq: { $exists: false } } },
      { $group: { _id: { accountId: "$accountId", nudgeId: "$nudgeId" } } },
    ])
    .toArray();

  let migrated = 0;
  for (const { _id } of groups) {
    const legacy = await rows
      .find({ ...(_id as object), seq: { $exists: false } })
      .sort({ at: 1, _id: 1 })
      .project({ _id: 1 })
      .toArray();
    await rows.bulkWrite(
      legacy.map((row, rank) => ({
        updateOne: {
          filter: { _id: row._id },
          update: { $set: { seq: rank - legacy.length }, $unset: { at: "" } },
        },
      })),
    );
    migrated += legacy.length;
  }

  for (const name of OLD_INDEXES) await rows.dropIndex(name).catch(() => undefined);
  await ensureIndexes(db);
  console.log(`Migrated ${migrated} check-in(s). database=${dbName}`);
}).catch(fail);
