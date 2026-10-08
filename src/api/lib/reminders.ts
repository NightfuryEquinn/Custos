import { emailConfigured, sendEmail } from "@/api/lib/email";
import { reminderEmailTemplate } from "@/api/lib/reminder-email-html";
import { formatMoneyLabel } from "@/api/lib/money";
import {
  accountHasPushSubscription,
  pushConfigured,
  reminderPushPayload,
  sendPushToAccount,
} from "@/api/lib/push";
import { getCollections, getDb } from "@/db";
import type { EventDocument, ReminderChannel, ReminderLogDocument } from "@/db/collections";
import {
  formatOccurrenceWhen,
  isOccurrencePast,
  isReminderDueNow,
  leadDescription,
  occurrenceEndMs,
  reminderTargets,
  spanDays,
  type ReminderTarget,
} from "@/lib/schedule";
import { DEFAULT_TIMEZONE } from "@/lib/timezone";
import { spanDaysBetween, type LeadId } from "@/schemas/common";
import { ObjectId } from "mongodb";

const EVENT_CAT_NAMES: Record<string, string> = {
  bill: "Bill / Payment",
  income: "Income",
  savings: "Savings",
  renewal: "Renewal",
  appointment: "Appointment",
  personal: "Personal",
  custom: "Custom",
};

/** Bound work per cron-job.org poll (aligned with ~30s request timeout). */
const REMINDER_BATCH_LIMIT = 80;
const CRON_TIME_BUDGET_MS = 22_000;
const SEND_CONCURRENCY = 5;

/** Human-readable label for an event's schedule category (plaintext catId only). */
function eventCategoryLabel(doc: { catId: string }): string {
  return EVENT_CAT_NAMES[doc.catId] ?? doc.catId;
}

/** Fallback title for events saved without a plaintext copy for delivery. */
const GENERIC_EVENT_TITLE = "Upcoming event";

/** 1-based position of a target's day within its occurrence. */
function dayNumberInSpan(target: ReminderTarget): number {
  return spanDaysBetween(target.occurrenceIso, target.dayIso);
}

/**
 * Content rendered in reminder emails. Event secrets are E2EE, so this comes
 * from the plaintext `notifyDetails` the client stores while reminders are on;
 * without it the email falls back to the generic, content-free form.
 */
function reminderContent(doc: EventDocument): {
  title: string;
  hold?: string;
  comments?: string[];
} {
  const details = doc.notifyDetails;
  if (!details) return { title: GENERIC_EVENT_TITLE };

  const hold = details.hold
    ? [
        formatMoneyLabel(details.hold.amount, details.hold.currency),
        details.hold.categoryName ? `from ${details.hold.categoryName}` : "",
      ]
        .filter(Boolean)
        .join(" ")
    : undefined;

  return {
    title: details.title.trim() || GENERIC_EVENT_TITLE,
    ...(hold ? { hold } : {}),
    ...(details.comments?.length ? { comments: details.comments } : {}),
  };
}

type ReminderProcessResult = {
  scanned: number;
  sent: number;
  skipped: number;
  errors: string[];
  truncated?: boolean;
};

/**
 * Per-account channel state.
 * `emailEnabled` is the global opt-out from the Data & privacy modal; an absent
 * field means enabled (default opt-in per event). `pushEnabled` is simply
 * whether any device registered a push endpoint — the subscription is the opt-in.
 */
type UserReminderPrefs = {
  emailEnabled: boolean;
  pushEnabled: boolean;
  timezone: string;
  notifyEmail: string;
};

/** Load per-channel reminder eligibility and timezone for an account. */
async function userReminderPrefs(accountId: string): Promise<UserReminderPrefs> {
  const { users } = getCollections(getDb());
  const [user, hasPush] = await Promise.all([
    users.findOne(
      { _id: new ObjectId(accountId) },
      { projection: { emailRemindersEnabled: 1, timezone: 1, notifyEmail: 1 } },
    ),
    pushConfigured() ? accountHasPushSubscription(accountId) : Promise.resolve(false),
  ]);

  return {
    emailEnabled: user?.emailRemindersEnabled !== false,
    pushEnabled: hasPush,
    timezone: user?.timezone ?? DEFAULT_TIMEZONE,
    notifyEmail: user?.notifyEmail?.trim() ?? "",
  };
}

/** Dedupe key for a reminder log row. */
function logKeyOf(eventId: string, dayIso: string, lead: string): string {
  return `${eventId}|${dayIso}|${lead}`;
}

/**
 * Channels a log row already covers. Rows written before Web Push existed have
 * no `channels` field and were email-only, so treat the absence as such.
 */
function loggedChannels(log: ReminderLogDocument): ReminderChannel[] {
  return log.channels ?? ["email"];
}

/** Run async tasks with a fixed concurrency cap. */
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function run(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]!);
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
  await Promise.all(runners);

  return results;
}

/** Send the "reminder enabled" confirmation email when an event turns notify on. */
export async function sendEventConfirmation(doc: EventDocument): Promise<void> {
  if (!doc.notify) return;
  if (!emailConfigured()) return;

  const prefs = await userReminderPrefs(doc.accountId);
  if (!prefs.emailEnabled || !prefs.notifyEmail) return;

  const when = formatOccurrenceWhen(doc, doc.date, prefs.timezone);
  const category = eventCategoryLabel(doc);
  const span = spanDays(doc);
  /* Every notifying event also gets a reminder right at its own start — the chosen
     lead is an extra early warning, not the only one — unless the chosen lead already
     is "at" (see reminderTargets' dedupe in @/lib/schedule). */
  const chosenLead = leadDescription(doc.lead as LeadId, doc.allDay);
  const atLead = leadDescription("at" as LeadId, doc.allDay);
  const leadSummary = doc.lead === "at" ? chosenLead : `${chosenLead}, and again ${atLead}`;
  /* Multi-day events also get a daily nudge, so say so up front. */
  const lead = span > 1 ? `${leadSummary}, then each morning it is still running` : leadSummary;
  const { id, subject, variables } = reminderEmailTemplate({
    ...reminderContent(doc),
    when,
    category,
    lead,
    isConfirmation: true,
  });

  await sendEmail({ to: prefs.notifyEmail, subject, template: { id, variables } });
}

/**
 * Cron entry: scan notify events and deliver due reminders (batched).
 * Email and Web Push are independent channels — either alone is enough to run.
 */
export async function processDueReminders(now = new Date()): Promise<ReminderProcessResult> {
  const result: ReminderProcessResult = { scanned: 0, sent: 0, skipped: 0, errors: [] };

  const emailReady = emailConfigured();
  const pushReady = pushConfigured();
  if (!emailReady && !pushReady) {
    result.errors.push("no reminder channel configured (RESEND_API_KEY / VAPID_* keys)");

    return result;
  }

  const { events, reminderLogs } = getCollections(getDb());
  const nowMs = now.getTime();
  const started = Date.now();
  const totalNotify = await events.countDocuments({ notify: true });

  /* Cache per-user reminder prefs across events in this run. */
  const prefsCache = new Map<string, UserReminderPrefs>();

  type PendingSend = {
    ev: EventDocument;
    target: ReminderTarget;
    email: string;
    timezone: string;
    /** Channels this event is eligible for before dedupe. */
    channels: ReminderChannel[];
  };
  const pending: PendingSend[] = [];
  const scannedIds = new Set<string>();

  while (Date.now() - started < CRON_TIME_BUDGET_MS && scannedIds.size < totalNotify) {
    const scanFilter: Record<string, unknown> = { notify: true };
    if (scannedIds.size) {
      scanFilter._id = { $nin: [...scannedIds].map((id) => new ObjectId(id)) };
    }

    const batch = await events
      .find(scanFilter)
      .sort({ lastScannedAt: 1, _id: 1 })
      .limit(REMINDER_BATCH_LIMIT)
      .toArray();
    if (!batch.length) break;

    let newInBatch = 0;
    for (const ev of batch) {
      if (Date.now() - started > CRON_TIME_BUDGET_MS) {
        result.truncated = true;
        break;
      }

      const evId = ev._id.toHexString();
      if (scannedIds.has(evId)) continue;
      scannedIds.add(evId);
      newInBatch++;
      result.scanned++;

      let prefs = prefsCache.get(ev.accountId);
      if (!prefs) {
        prefs = await userReminderPrefs(ev.accountId);
        prefsCache.set(ev.accountId, prefs);
      }

      const email = prefs.notifyEmail;
      const channels: ReminderChannel[] = [];
      if (emailReady && prefs.emailEnabled && email) channels.push("email");
      if (pushReady && prefs.pushEnabled) channels.push("push");

      if (!channels.length) {
        result.skipped++;
        await events.updateOne({ _id: ev._id }, { $set: { lastScannedAt: new Date() } });
        continue;
      }

      for (const target of reminderTargets(ev, now, prefs.timezone)) {
        if (!isReminderDueNow(target.remindAtMs, nowMs)) continue;

        if (isOccurrencePast(occurrenceEndMs(ev, target.occurrenceIso, prefs.timezone), nowMs)) {
          result.skipped++;
          continue;
        }

        pending.push({ ev, target, email, timezone: prefs.timezone, channels });
      }

      await events.updateOne({ _id: ev._id }, { $set: { lastScannedAt: new Date() } });
    }

    if (newInBatch === 0) break;
    if (batch.length < REMINDER_BATCH_LIMIT) break;
    if (result.truncated) break;
    if (scannedIds.size >= totalNotify) break;
  }

  if (Date.now() - started >= CRON_TIME_BUDGET_MS) {
    result.truncated = true;
  }

  if (pending.length) {
    /* Prefetch existing reminder logs for this batch to skip duplicates. */
    const logFilter = {
      $or: pending.map((p) => ({
        eventId: p.ev._id,
        occurrenceIso: p.target.dayIso,
        lead: p.target.logLead,
      })),
    };
    const existingLogs = await reminderLogs.find(logFilter).toArray();
    const alreadySent = new Map<string, Set<ReminderChannel>>();
    for (const log of existingLogs) {
      const key = logKeyOf(log.eventId.toHexString(), log.occurrenceIso, log.lead);
      alreadySent.set(key, new Set(loggedChannels(log)));
    }

    /* Dedupe per channel: a reminder already emailed can still be pushed. */
    const toSend = pending.flatMap((p) => {
      const key = logKeyOf(p.ev._id.toHexString(), p.target.dayIso, p.target.logLead);
      const logged = [...(alreadySent.get(key) ?? [])];
      const remaining = p.channels.filter((ch) => !logged.includes(ch));
      if (!remaining.length) {
        result.skipped++;

        return [];
      }

      return [{ ...p, channels: remaining, logged }];
    });

    const outcomes = await mapPool(toSend, SEND_CONCURRENCY, (item) =>
      sendReminderOnce(item.ev, item.target, item.email, item.timezone, item.channels, item.logged),
    );

    for (const outcome of outcomes) {
      if (outcome === "sent") result.sent++;
      else if (outcome === "skipped") result.skipped++;
      else result.errors.push(outcome.error);
    }
  }

  return result;
}

/**
 * Delivers one reminder target over the given channels, deduped via reminderLogs.
 * Channels are independent: an email failure never suppresses the push, and the
 * log records only what actually went out so the next poll retries the rest.
 * Returns "skipped" when every requested channel already fired.
 */
async function sendReminderOnce(
  ev: EventDocument,
  target: ReminderTarget,
  email: string,
  timezone: string,
  channels: ReminderChannel[],
  /** Channels the caller already knows fired; omit to look them up here. */
  alreadyLogged?: ReminderChannel[],
): Promise<"sent" | "skipped" | { error: string }> {
  const { reminderLogs } = getCollections(getDb());
  const logKey = {
    eventId: ev._id,
    occurrenceIso: target.dayIso,
    lead: target.logLead,
  };

  let logged = alreadyLogged;
  if (!logged) {
    const existing = await reminderLogs.findOne(logKey);
    logged = existing ? loggedChannels(existing) : [];
  }

  const done = new Set(logged);
  const wanted = channels.filter((ch) => !done.has(ch));
  if (!wanted.length) return "skipped";

  const span = spanDays(ev);
  const when = formatOccurrenceWhen(ev, target.occurrenceIso, timezone);
  const category = eventCategoryLabel(ev);
  /* A "still running" send is about today, not about a lead time. Each `kind: "lead"`
     target names its own lead (`target.logLead`) rather than `ev.lead`, since the
     always-on at-event reminder (`logLead: "at"`) is a separate send from the user's
     chosen lead and must not be mislabelled as it. */
  const lead =
    target.kind === "ongoing"
      ? `while this event is running (day ${dayNumberInSpan(target)} of ${span})`
      : leadDescription(target.logLead as LeadId, ev.allDay);

  /* Both channels render from the same plaintext copy so they never drift. */
  const content = reminderContent(ev);

  const [emailResult, pushResult] = await Promise.all([
    wanted.includes("email")
      ? (async () => {
          const { id, subject, variables } = reminderEmailTemplate({
            ...content,
            when,
            category,
            lead,
          });

          return sendEmail({ to: email, subject, template: { id, variables } });
        })()
      : null,
    wanted.includes("push")
      ? sendPushToAccount(
          ev.accountId,
          reminderPushPayload({
            ...content,
            when,
            category,
            tag: logKeyOf(ev._id.toHexString(), target.dayIso, target.logLead),
          }),
        )
      : null,
  ]);

  const delivered: ReminderChannel[] = [];
  const errors: string[] = [];

  if (emailResult) {
    if (emailResult.ok) delivered.push("email");
    else errors.push(emailResult.error || "email delivery failed");
  }
  if (pushResult) {
    if (pushResult.sent > 0) delivered.push("push");
    else errors.push(pushResult.errors[0] ?? "no push endpoints reachable");
  }

  if (!delivered.length) {
    return { error: errors.join("; ") || "no reminder channel delivered" };
  }

  try {
    await reminderLogs.updateOne(
      logKey,
      {
        /* Re-add the known channels too: rows written before Web Push have no
           `channels` field, and materializing it here keeps the implicit
           "email already sent" from being lost on the first push. */
        $addToSet: { channels: { $each: [...logged, ...delivered] } },
        /* Filter fields are seeded from the equality match on insert. */
        $setOnInsert: { email, accountId: ev.accountId, sentAt: new Date() },
      },
      { upsert: true },
    );
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 11000) return "skipped";

    return { error: "failed to log reminder send" };
  }

  return "sent";
}

/**
 * Called when an event is created or updated. If the remind-at time is inside
 * the current poll window, send immediately instead of waiting for cron-job.org.
 */
export async function sendImmediateReminderIfDue(
  doc: EventDocument,
  now = new Date(),
): Promise<void> {
  if (!doc.notify) return;

  const prefs = await userReminderPrefs(doc.accountId);
  const email = prefs.notifyEmail;

  const channels: ReminderChannel[] = [];
  if (emailConfigured() && prefs.emailEnabled && email) channels.push("email");
  if (pushConfigured() && prefs.pushEnabled) channels.push("push");
  if (!channels.length) return;

  const nowMs = now.getTime();

  for (const target of reminderTargets(doc, now, prefs.timezone)) {
    /* Occurrence already finished. */
    if (isOccurrencePast(occurrenceEndMs(doc, target.occurrenceIso, prefs.timezone), nowMs))
      continue;
    if (!isReminderDueNow(target.remindAtMs, nowMs)) continue;

    const outcome = await sendReminderOnce(doc, target, email, prefs.timezone, channels);
    if (typeof outcome !== "string") {
      console.error(
        `[reminders] immediate send failed for event ${doc._id} (${target.dayIso}): ${outcome.error}`,
      );
    }
  }
}

/** Delete reminder send logs for an event (e.g. after delete or major edit). */
export async function clearReminderLogsForEvent(eventId: ObjectId): Promise<void> {
  const { reminderLogs } = getCollections(getDb());
  await reminderLogs.deleteMany({ eventId });
}
