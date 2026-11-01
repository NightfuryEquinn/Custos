import { getCollections, getDb } from "@/db";
import webpush from "web-push";

/**
 * Web Push (W3C) delivery — the second reminder channel alongside email.
 * Subscriptions are per-device; a row in `push_subscriptions` *is* the opt-in.
 */

type PushPayload = {
  title: string;
  body: string;
  /** Collapse key so a re-delivered reminder replaces rather than stacks. */
  tag: string;
  /** Relative path the notification opens on click. */
  url: string;
};

/** Whether VAPID credentials are configured for Web Push. */
export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim());
}

/** Application server key the browser needs to create a subscription. */
export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null;
}

/* web-push keeps VAPID details on module state; set them once per process. */
let vapidReady = false;

function ensureVapid(): boolean {
  if (vapidReady) return true;
  if (!pushConfigured()) return false;

  /* Push services require a contact URL; mailto is the conventional form. */
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:noreply@custos.app";
  webpush.setVapidDetails(
    subject,
    process.env.VAPID_PUBLIC_KEY!.trim(),
    process.env.VAPID_PRIVATE_KEY!.trim(),
  );
  vapidReady = true;

  return true;
}

/** Whether an account has at least one registered push endpoint. */
export async function accountHasPushSubscription(accountId: string): Promise<boolean> {
  const { pushSubscriptions } = getCollections(getDb());
  const existing = await pushSubscriptions.findOne({ accountId }, { projection: { _id: 1 } });

  return Boolean(existing);
}

/**
 * Deliver a payload to every device matching `filter`.
 * Endpoints the push service reports as gone (404/410) are pruned.
 */
async function sendPushTo(
  filter: { accountId?: string },
  payload: PushPayload,
): Promise<{ sent: number; errors: string[] }> {
  if (!ensureVapid()) return { sent: 0, errors: ["VAPID keys not configured"] };

  const { pushSubscriptions } = getCollections(getDb());
  const subs = await pushSubscriptions.find(filter).toArray();
  if (!subs.length) return { sent: 0, errors: [] };

  const body = JSON.stringify(payload);
  const expired: string[] = [];
  const errors: string[] = [];
  let sent = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body);
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        /* Standard "this endpoint is dead" signals — drop the row. */
        if (status === 404 || status === 410) {
          expired.push(sub.endpoint);

          return;
        }
        errors.push(`push ${status ?? "error"}: ${(err as Error).message}`);
      }
    }),
  );

  if (expired.length) {
    await pushSubscriptions.deleteMany({ endpoint: { $in: expired } });
  }

  return { sent, errors };
}

/** Deliver a payload to every device registered for an account. */
export async function sendPushToAccount(
  accountId: string,
  payload: PushPayload,
): Promise<{ sent: number; errors: string[] }> {
  return sendPushTo({ accountId }, payload);
}

/**
 * Deliver a payload to every registered device, across all accounts.
 * Used for release-broadcast notifications, not per-account reminders.
 */
export async function broadcastPush(
  payload: PushPayload,
): Promise<{ sent: number; errors: string[] }> {
  return sendPushTo({}, payload);
}

/**
 * Build the reminder notification from the same content the email renders,
 * so the two channels never drift.
 */
export function reminderPushPayload(opts: {
  title: string;
  when: string;
  category: string;
  hold?: string;
  comments?: string[];
  tag: string;
}): PushPayload {
  const lines = [`${opts.when} · ${opts.category}`];
  if (opts.hold) lines.push(`Hold ${opts.hold}`);

  const comments = (opts.comments ?? []).filter((c) => c.trim());
  if (comments.length) lines.push(comments.join(" · "));

  return {
    title: `Upcoming: ${opts.title}`,
    body: lines.join("\n"),
    tag: opts.tag,
    url: "/",
  };
}
