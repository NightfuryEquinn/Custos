import { randomObjectId } from "@/api/lib/ids";
import { accountTimezone } from "@/api/lib/nudges";
import { createHash } from "node:crypto";
import { COLLECTIONS, getCollections, getDb } from "@/db";
import type { ExpenseDocument, RateLimitDocument } from "@/db/collections";
import type { Collection } from "mongodb";
import {
  RECURRING_CATCHUP_LIMIT,
  formatIsoDateParts,
  nextRecurringDueDate,
  normalizeRecurring,
  parseIsoDate,
  recurringScheduleKey,
  zonedTodayIso,
  type RecurringInterval,
} from "@/lib/recurring";

/** Only materialize dues in the last ~5 weeks (missed cron days), not years of history. */
const LOOKBACK_DAYS = 35;

/** Bound work per cron-job.org poll (aligned with ~30s request timeout). */
const ANCHOR_BATCH_LIMIT = 200;
const CRON_TIME_BUDGET_MS = 22_000;

type RecurringMaterializeResult = {
  scanned: number;
  series: number;
  created: number;
  skipped: number;
  errors: string[];
  truncated?: boolean;
  /** A run was already in flight (see acquireCronLock) — this call did nothing. */
  locked?: boolean;
};

/* cron-job.org's own retry-on-timeout, plus an overlapping manual trigger,
   can otherwise run a cron job twice at once. For this one, both instances
   read "no occurrence for date X yet" before either inserts, so the dedupe
   indexes only backstop the race, they don't prevent it. This lock does.
   Reuses the same rate-limit-bucket collection/shape as
   middleware/rate-limit.ts: `_id` unique-constrains one holder, `resetAt`'s
   TTL index is a safety net if the process dies mid-run without releasing it. */
const RECURRING_LOCK_ID = "cron-lock:recurring-expenses";
const CRON_LOCK_TTL_MS = 5 * 60_000;

/** Try to take the named cron lock; false if another run already holds it. */
export async function acquireCronLock(id: string): Promise<boolean> {
  const col = getDb().collection<RateLimitDocument>(COLLECTIONS.rateLimits);
  try {
    await col.insertOne({
      _id: id,
      count: 1,
      resetAt: new Date(Date.now() + CRON_LOCK_TTL_MS),
    });
    return true;
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
    return false;
  }
}

export async function releaseCronLock(id: string): Promise<void> {
  const col = getDb().collection<RateLimitDocument>(COLLECTIONS.rateLimits);
  await col.deleteOne({ _id: id }).catch(() => {
    /* best-effort — the TTL index still clears it if this fails */
  });
}

/** Build a legacy plaintext series key for dedupe. */
function legacySeriesKey(doc: ExpenseDocument): string {
  return recurringScheduleKey({
    walletId: doc.walletId?.toString() ?? "",
    sub: doc.sub ?? "",
    note: doc.note ?? "",
    recurring: doc.recurring,
  });
}

/** Prefer encrypted seriesKey when present. */
function seriesKey(doc: ExpenseDocument): string {
  if (doc.enc === 1 && doc.seriesKey) return doc.seriesKey;

  return legacySeriesKey(doc);
}

/** Add a signed day delta to an ISO calendar date. */
function addDaysIso(iso: string, delta: number): string {
  const { y, m, d } = parseIsoDate(iso);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));

  return formatIsoDateParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Resolve a user's IANA timezone, caching by accountId. */
async function userTimezone(accountId: string, cache: Map<string, string>): Promise<string> {
  const hit = cache.get(accountId);
  if (hit) return hit;
  const tz = await accountTimezone(accountId);
  cache.set(accountId, tz);

  return tz;
}

/** Collect due ISO dates for a series between lookback and today. */
function collectDueDates(
  anchorIso: string,
  freq: RecurringInterval,
  cursorStart: string,
  today: string,
  minDue: string,
): string[] {
  const dues: string[] = [];
  let cursor = cursorStart;
  let createdForSeries = 0;

  while (createdForSeries < RECURRING_CATCHUP_LIMIT) {
    const due = nextRecurringDueDate(anchorIso, freq, cursor);
    if (!due || due > today) break;
    if (due >= minDue) {
      dues.push(due);
      createdForSeries++;
    }
    cursor = due;
  }

  return dues;
}

/**
 * Create ledger rows for due recurring expenses/income through each user's local today.
 * Idempotent: skips dates that already have a matching series row.
 * Prefetches existing dates and uses insertMany to avoid N+1 writes.
 */
export async function processDueRecurringExpenses(
  now = new Date(),
): Promise<RecurringMaterializeResult> {
  const locked = await acquireCronLock(RECURRING_LOCK_ID);
  if (!locked) {
    return { scanned: 0, series: 0, created: 0, skipped: 0, errors: [], locked: true };
  }
  try {
    return await materializeDueRecurringExpenses(now);
  } finally {
    await releaseCronLock(RECURRING_LOCK_ID);
  }
}

async function materializeDueRecurringExpenses(now: Date): Promise<RecurringMaterializeResult> {
  const result: RecurringMaterializeResult = {
    scanned: 0,
    series: 0,
    created: 0,
    skipped: 0,
    errors: [],
  };

  const { expenses } = getCollections(getDb());
  const started = Date.now();

  const tzCache = new Map<string, string>();

  while (Date.now() - started < CRON_TIME_BUDGET_MS) {
    const pendingInserts: ExpenseDocument[] = [];
    const anchors = await expenses
      .find({
        recurring: { $in: [true, "monthly", "quarterly", "yearly"] },
        walletId: { $exists: true },
        skipped: { $ne: true },
      } as Record<string, unknown>)
      .sort({ lastScannedAt: 1, _id: 1 })
      .limit(ANCHOR_BATCH_LIMIT)
      .toArray();

    if (!anchors.length) break;

    result.scanned += anchors.length;
    const scanStamp = new Date();

    /** Latest row supplies payload/amount; earliest date supplies day-of-month (avoids clamp drift). */
    type SeriesState = { latest: ExpenseDocument; anchorIso: string };
    const bySeries = new Map<string, SeriesState>();
    for (const doc of anchors) {
      const freq = normalizeRecurring(doc.recurring);
      if (!freq || !doc.walletId) continue;
      const key = `${doc.accountId}|${seriesKey(doc)}`;
      const prev = bySeries.get(key);
      if (!prev) {
        bySeries.set(key, { latest: doc, anchorIso: doc.date });
        continue;
      }
      if (doc.date > prev.latest.date) prev.latest = doc;
      if (doc.date < prev.anchorIso) prev.anchorIso = doc.date;
    }

    result.series += bySeries.size;
    const processedKeys = new Set<string>();

    for (const [key, { latest: template, anchorIso }] of bySeries) {
      if (Date.now() - started > CRON_TIME_BUDGET_MS) {
        result.truncated = true;
        break;
      }

      /* Mark considered before any `continue`, so series with nothing due
         still rotate out of the next poll's front of the queue. */
      processedKeys.add(key);

      const freq = normalizeRecurring(template.recurring) as RecurringInterval;
      if (!template.walletId) {
        result.skipped++;
        continue;
      }

      try {
        const tz = await userTimezone(template.accountId, tzCache);
        const today = zonedTodayIso(tz, now);
        const minDue = addDaysIso(today, -LOOKBACK_DAYS);
        const dues = collectDueDates(anchorIso, freq, template.date, today, minDue);
        if (!dues.length) continue;

        const encrypted = template.enc === 1;
        const existingFilter = encrypted
          ? {
              accountId: template.accountId,
              walletId: template.walletId,
              seriesKey: template.seriesKey,
              date: { $in: dues },
              recurring: freq === "monthly" ? ({ $in: ["monthly", true] } as const) : freq,
            }
          : {
              accountId: template.accountId,
              walletId: template.walletId,
              sub: template.sub,
              note: template.note,
              date: { $in: dues },
              recurring: freq === "monthly" ? ({ $in: ["monthly", true] } as const) : freq,
            };

        const existing = await expenses.find(existingFilter as Record<string, unknown>).toArray();
        const existingDates = new Set(existing.map((row) => row.date));

        const stamp = new Date();
        for (const due of dues) {
          if (existingDates.has(due)) {
            result.skipped++;
            continue;
          }
          pendingInserts.push({
            _id: randomObjectId(),
            accountId: template.accountId,
            walletId: template.walletId,
            kind: template.kind ?? "expense",
            date: due,
            recurring: freq,
            ...(encrypted
              ? {
                  enc: 1 as const,
                  payload: template.payload!,
                  seriesKey: template.seriesKey,
                }
              : {
                  sub: template.sub!,
                  amount: template.amount!,
                  note: template.note ?? "",
                }),
            createdAt: stamp,
            updatedAt: stamp,
          } as ExpenseDocument);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        /* Never surface the legacy plaintext note/sub (or a recognizable
           prefix of any identifier) here — this label rides in the cron
           JSON response body, which cron-job.org retains in job history.
           seriesKey() is already opaque for encrypted templates (an HMAC),
           but for a legacy template it's a raw `walletId|sub|note|freq`
           concatenation — slicing that directly would leak a wallet-id
           prefix (or, if walletId is ever nullish, a subcategory-id
           prefix). Hash it instead so this stays a stable-but-unrecoverable
           grouping key either way. */
        const label = createHash("sha256").update(seriesKey(template)).digest("hex").slice(0, 8);
        result.errors.push(`${label} (${anchorIso}): ${msg}`);
      }
    }

    /* Insert per batch, not once at the end — a run that hits the time
       budget or throws partway through a later batch still keeps the rows
       it already computed, instead of losing all of them because the one
       insertMany() never ran. */
    if (pendingInserts.length) {
      result.created += await insertRecurringRows(expenses, pendingInserts, result.errors);
    }

    const stampIds = anchors
      .filter((doc) => {
        const freq = normalizeRecurring(doc.recurring);
        if (!freq || !doc.walletId) return true;

        return processedKeys.has(`${doc.accountId}|${seriesKey(doc)}`);
      })
      .map((doc) => doc._id);
    if (stampIds.length) {
      await expenses.updateMany({ _id: { $in: stampIds } }, { $set: { lastScannedAt: scanStamp } });
    }

    if (anchors.length < ANCHOR_BATCH_LIMIT) break;
    if (result.truncated) break;
  }

  if (Date.now() - started >= CRON_TIME_BUDGET_MS) {
    result.truncated = true;
  }

  return result;
}

/** Insert computed dues; duplicate keys from overlapping runs count as created=0, not a crash. */
async function insertRecurringRows(
  expenses: Collection<ExpenseDocument>,
  rows: ExpenseDocument[],
  errors: string[],
): Promise<number> {
  try {
    const inserted = await expenses.insertMany(rows, { ordered: false });

    return inserted.insertedCount;
  } catch (err) {
    const bulk = err as {
      insertedCount?: number;
      writeErrors?: { code?: number }[];
    };
    const writeErrors = bulk.writeErrors;
    if (!writeErrors) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`insert: ${msg}`);

      return 0;
    }

    if (writeErrors.some((item) => item.code !== 11000)) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`insert: ${msg}`);
    }

    return bulk.insertedCount ?? 0;
  }
}
