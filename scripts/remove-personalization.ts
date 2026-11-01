/**
 * One-off: erase what the retired 7.0.0 Suggestions feature left in the database.
 *
 * Drops the encrypted `personalization_history` collection (and its indexes), strips the
 * `personalization` fields from consent records, and removes the "suggestions" view id from
 * profiles so start pages and favorites fall back cleanly. Safe to run again.
 *
 * Usage:
 *   bun scripts/remove-personalization.ts
 *
 * Requires MONGODB_URI (and optional MONGODB_DB) from the environment / .env.
 */

import { COLLECTIONS } from "../src/db/collections";
import { fail, withDb } from "./lib/mongo";

withDb(async (db, dbName) => {
  const dropped = await db
    .collection("personalization_history")
    .drop()
    .catch((err: { codeName?: string }) => {
      if (err.codeName === "NamespaceNotFound") return false;
      throw err;
    });

  const consent = await db.collection(COLLECTIONS.consent).updateMany(
    {
      $or: [{ personalization: { $exists: true } }, { personalizationSerial: { $exists: true } }],
    },
    { $unset: { personalization: "", personalizationSerial: "" } },
  );

  const profiles = db.collection(COLLECTIONS.ledgerProfiles);
  const start = await profiles.updateMany(
    { startView: "suggestions" },
    { $unset: { startView: "" } },
  );
  const tabs = await profiles.updateMany({ navTabs: "suggestions" }, { $unset: { navTabs: "" } });
  const order = await profiles.updateMany(
    { navOrder: "suggestions" },
    { $pull: { navOrder: "suggestions" } as never },
  );

  console.log(
    `history dropped=${dropped} consent=${consent.modifiedCount} startView=${start.modifiedCount} ` +
      `navTabs=${tabs.modifiedCount} navOrder=${order.modifiedCount} database=${dbName}`,
  );
}).catch(fail);
