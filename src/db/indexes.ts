import type { Db } from "mongodb";
import { COLLECTIONS } from "./collections";

/**
 * Drop an index by name if it exists under a now-stale definition.
 * `createIndex` refuses to redefine an existing same-named index in place
 * (different options, e.g. adding `unique`, is an error, not a silent
 * upgrade) — "index not found" (code 27) just means there was nothing to
 * drop, which is the common case once a redefinition has rolled out once.
 */
async function dropStaleIndex(db: Db, collection: string, name: string): Promise<void> {
  try {
    await db.collection(collection).dropIndex(name);
  } catch (err) {
    /* 26 = NamespaceNotFound (collection doesn't exist yet, e.g. a fresh
       database), 27 = IndexNotFound (already dropped, or never existed
       under this name) — both mean "nothing to drop", not a real failure. */
    const code = (err as { code?: number }).code;
    if (code !== 26 && code !== 27) throw err;
  }
}

/**
 * Ensure Mongo indexes for the current schema (accountId ownership).
 *
 * Run at build time (`bun run db:indexes`, wired into the Vercel build
 * command) rather than per-request: this used to run inside connectDb() on
 * every cold serverless isolate, paying 13 serial dropIndex round trips
 * (the address-keyed legacy indexes below, all long since dropped for real
 * — every one of them now just throws and is caught) plus ~25 createIndex
 * calls before that isolate's first request could be served.
 *
 * The legacy address-keyed drops this used to carry are gone — if that
 * migration ever needs repeating, add the drops back temporarily.
 */
export async function ensureIndexes(db: Db): Promise<void> {
  /* One-time redefinitions: these three existed under the same name with
     different options (no `unique`, and — for the plaintext recurring
     lookup — no `enc` exclusion in the partial filter) before this change.
     createIndex() below would otherwise fail with "An existing index has
     the same name as the requested index." Safe to remove once this has
     rolled out to every environment, same as the historical address-keyed
     drops mentioned above. */
  await Promise.all([
    dropStaleIndex(db, COLLECTIONS.financialWallets, "accountId_1_isDefault_1"),
    dropStaleIndex(db, COLLECTIONS.expenses, "recurring_occurrence_lookup"),
    dropStaleIndex(db, COLLECTIONS.expenses, "recurring_encrypted_occurrence_lookup"),
  ]);

  await Promise.all([
    db.collection(COLLECTIONS.users).createIndex({ address: 1 }, { unique: true }),
    db.collection(COLLECTIONS.ledgerProfiles).createIndex({ accountId: 1 }, { unique: true }),
    /* unique: two racing check-then-act inserts (migrateLegacyData in
       routes/wallets.ts, or a queue drain landing at the same moment as a
       page load) both seeing zero wallets previously produced two rows both
       flagged isDefault — this constrains it to one per account. If the
       database already holds duplicates, this index build fails — dedupe
       them (keep one wallet flagged isDefault per account) before deploying. */
    db.collection(COLLECTIONS.financialWallets).createIndex(
      { accountId: 1, isDefault: 1 },
      {
        unique: true,
        partialFilterExpression: { isDefault: true },
      },
    ),
    db.collection(COLLECTIONS.categoryTaxonomies).createIndex({ accountId: 1 }, { unique: true }),
    db.collection(COLLECTIONS.expenses).createIndex({ accountId: 1, walletId: 1, date: -1 }),
    db.collection(COLLECTIONS.expenses).createIndex({ accountId: 1, date: -1 }),
    db.collection(COLLECTIONS.expenses).createIndex({ accountId: 1, recurring: 1, date: -1 }),
    /* Releasing a deleted plan's deposits filters on this; partial because most
       expenses carry no plan. */
    db.collection(COLLECTIONS.expenses).createIndex(
      { accountId: 1, capitalPlanId: 1 },
      {
        name: "capital_plan_assignment",
        partialFilterExpression: { capitalPlanId: { $exists: true } },
      },
    ),
    /* Dedupe for cron materialization (legacy plaintext series). unique: the
       cron lock in recurring-expenses.ts stops two runs from overlapping in
       this process, but this is the backstop against any other path (a
       second deploy region, a manual trigger racing the schedule) inserting
       the same occurrence twice. If the database already holds duplicate
       occurrences, this index build fails — dedupe them (keep one row per
       series+date) before deploying.
       `enc: {$ne: 1}` matters here, not just documentation: an encrypted
       document carries neither `sub` nor `note`, so without excluding it
       this index would also cover encrypted docs and — since two unrelated
       encrypted series on the same wallet+date both index as
       `sub:null, note:null` — collide two legitimate different series into
       one unique key. Encrypted docs are deduped by the seriesKey index below
       instead. */
    db.collection(COLLECTIONS.expenses).createIndex(
      { accountId: 1, walletId: 1, sub: 1, note: 1, recurring: 1, date: 1 },
      {
        name: "recurring_occurrence_lookup",
        unique: true,
        partialFilterExpression: {
          recurring: { $in: [true, "monthly", "quarterly", "yearly"] },
          walletId: { $exists: true },
          enc: { $ne: 1 },
        },
      },
    ),
    /* Dedupe for encrypted recurring series — see the plaintext index above. */
    db.collection(COLLECTIONS.expenses).createIndex(
      { accountId: 1, walletId: 1, seriesKey: 1, recurring: 1, date: 1 },
      {
        name: "recurring_encrypted_occurrence_lookup",
        unique: true,
        partialFilterExpression: {
          enc: 1,
          recurring: { $in: [true, "monthly", "quarterly", "yearly"] },
          walletId: { $exists: true },
          seriesKey: { $exists: true },
        },
      },
    ),
    db.collection(COLLECTIONS.events).createIndex({ accountId: 1, date: 1 }),
    db.collection(COLLECTIONS.consent).createIndex({ accountId: 1 }, { unique: true }),
    db.collection(COLLECTIONS.authNonces).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection(COLLECTIONS.authNonces).createIndex({ address: 1, nonce: 1 }),
    db.collection(COLLECTIONS.sessions).createIndex({ tokenHash: 1 }, { unique: true }),
    /* Rotation grace-window lookup — see sessionAuth's $or in middleware/session.ts. */
    db.collection(COLLECTIONS.sessions).createIndex({ prevTokenHash: 1 }),
    db.collection(COLLECTIONS.sessions).createIndex({ accountId: 1, createdAt: -1 }),
    db.collection(COLLECTIONS.sessions).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db
      .collection(COLLECTIONS.events)
      .createIndex(
        { notify: 1, lastScannedAt: 1 },
        { partialFilterExpression: { notify: true }, name: "events_notify_last_scanned" },
      ),
    db.collection(COLLECTIONS.expenses).createIndex({ lastScannedAt: 1, _id: 1 }),
    db
      .collection(COLLECTIONS.reminderLogs)
      .createIndex({ eventId: 1, occurrenceIso: 1, lead: 1 }, { unique: true }),
    db
      .collection(COLLECTIONS.reminderLogs)
      .createIndex({ sentAt: 1 }, { expireAfterSeconds: 400 * 24 * 60 * 60 }),
    db
      .collection(COLLECTIONS.budgetAlertLogs)
      .createIndex(
        { accountId: 1, walletId: 1, categoryId: 1, month: 1, level: 1 },
        { unique: true },
      ),
    /* Month-keyed dedupe markers that nothing resolves back to a wallet or
       category, so they are pure growth once their month is past. */
    db
      .collection(COLLECTIONS.budgetAlertLogs)
      .createIndex({ sentAt: 1 }, { expireAfterSeconds: 400 * 24 * 60 * 60 }),
    db.collection(COLLECTIONS.todoLists).createIndex({ accountId: 1, createdAt: 1 }),
    db.collection(COLLECTIONS.capitalPlans).createIndex({ accountId: 1, createdAt: 1 }),
    db.collection(COLLECTIONS.vehicles).createIndex({ accountId: 1, createdAt: 1 }),
    db.collection(COLLECTIONS.vehicleFills).createIndex({ accountId: 1, vehicleId: 1, date: -1 }),
    db.collection(COLLECTIONS.vehicleFills).createIndex({ accountId: 1, date: -1 }),
    /* Push subscriptions: one row per browser endpoint, fanned out per account. */
    db.collection(COLLECTIONS.pushSubscriptions).createIndex({ endpoint: 1 }, { unique: true }),
    db.collection(COLLECTIONS.pushSubscriptions).createIndex({ accountId: 1 }),
    /* TTL cleanup for shared rate-limit buckets (resetAt is epoch ms). */
    db.collection(COLLECTIONS.rateLimits).createIndex({ resetAt: 1 }, { expireAfterSeconds: 0 }),
    /* Cron reminder scan: only events that opted into email notify. */
    db
      .collection(COLLECTIONS.events)
      .createIndex(
        { notify: 1 },
        { partialFilterExpression: { notify: true }, name: "events_notify_true" },
      ),
  ]);
}
