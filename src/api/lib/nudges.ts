import { mapPool } from "@/api/lib/reminders";
import { pushConfigured, sendPushToAccount } from "@/api/lib/push";
import { getCollections, getDb } from "@/db";
import { NUDGE_STALE_MS, nextNudgeAt } from "@/lib/nudge";
import { zonedTodayIso } from "@/lib/recurring";
import { DEFAULT_TIMEZONE } from "@/lib/timezone";
import type { updateNudgeSchema } from "@/schemas/nudge";
import { ObjectId } from "mongodb";
import type { z } from "zod";

/** Bound work per cron pass, and how many pushes go out at once. */
const NUDGE_BATCH_LIMIT = 200;
const SEND_CONCURRENCY = 5;

type NudgeInput = z.infer<typeof updateNudgeSchema>;

/** An account's timezone, which decides where its window and its "today" fall. */
export async function accountTimezone(accountId: string): Promise<string> {
  const { users } = getCollections(getDb());
  const user = await users.findOne(
    { _id: new ObjectId(accountId) },
    { projection: { timezone: 1 } },
  );

  return user?.timezone ?? DEFAULT_TIMEZONE;
}

/**
 * The plaintext columns of a saved nudge. `set` holds what is present and `unset`
 * what must be cleared: the readable copy and the goal date exist only while the nudge
 * is on, and the next slot likewise.
 */
export function nudgeColumns(body: NudgeInput, timeZone: string, nowMs = Date.now()) {
  const details = body.enabled ? body.notifyDetails : null;
  const metOn = body.enabled ? body.metOn : null;
  const set = {
    enabled: body.enabled,
    everyMin: body.everyMin,
    windowStart: body.windowStart,
    windowEnd: body.windowEnd,
    nextAt: body.enabled ? nextNudgeAt(body, nowMs, timeZone) : null,
    ...(details ? { notifyDetails: details } : {}),
    ...(metOn ? { metOn } : {}),
  };
  const unset: Record<string, ""> = {
    ...(details ? {} : { notifyDetails: "" }),
    ...(metOn ? {} : { metOn: "" }),
  };

  return { set, unset };
}

/**
 * Send every nudge whose slot has come. Each nudge is claimed by moving `nextAt` to its
 * following slot with the old value as the filter, so overlapping cron passes can never
 * send one twice. A slot that is stale (the cron was down), whose goal is already met for
 * the day, or that has no readable copy only advances; nothing is sent for it.
 */
export async function processDueNudges(
  now = new Date(),
): Promise<{ due: number; sent: number; skipped: number }> {
  if (!pushConfigured()) return { due: 0, sent: 0, skipped: 0 };

  const { nudges } = getCollections(getDb());
  const due = await nudges
    .find({ nextAt: { $lte: now } })
    .sort({ nextAt: 1 })
    .limit(NUDGE_BATCH_LIMIT)
    .toArray();
  const zones = new Map<string, Promise<string>>();
  const zoneOf = (accountId: string) => {
    if (!zones.has(accountId)) zones.set(accountId, accountTimezone(accountId));

    return zones.get(accountId)!;
  };

  const outcomes = await mapPool(due, SEND_CONCURRENCY, async (doc) => {
    const timeZone = await zoneOf(doc.accountId);
    const slot = doc.nextAt!;
    const next = doc.enabled ? nextNudgeAt(doc, now.getTime(), timeZone) : null;

    const claim = await nudges.updateOne(
      { _id: doc._id, nextAt: slot },
      { $set: { nextAt: next } },
    );
    if (claim.modifiedCount === 0) return "skipped";

    const stale = now.getTime() - slot.getTime() > NUDGE_STALE_MS;
    const met = doc.metOn === zonedTodayIso(timeZone, now);
    if (!doc.enabled || stale || met || !doc.notifyDetails) return "skipped";

    const result = await sendPushToAccount(doc.accountId, {
      title: doc.notifyDetails.title,
      body: doc.notifyDetails.body,
      /* One notification per nudge: an unseen one is replaced instead of stacking up. */
      tag: `nudge|${doc._id.toHexString()}`,
      url: "/#nudge",
    });

    return result.sent > 0 ? "sent" : "skipped";
  });

  const sent = outcomes.filter((o) => o === "sent").length;

  return { due: due.length, sent, skipped: due.length - sent };
}
