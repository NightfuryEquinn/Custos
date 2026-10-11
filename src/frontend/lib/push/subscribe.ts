import { api } from "@/frontend/lib/api";

/**
 * Web Push subscription for this device.
 * The subscription itself is the opt-in — enabling registers the endpoint with
 * the server, disabling removes it. Other devices are unaffected either way.
 */

export type PushStatus = {
  supported: boolean;
  permission: NotificationPermission;
  subscribed: boolean;
};

/** Whether this browser can do Web Push at all (iOS needs an installed PWA). */
function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined"
  );
}

/** VAPID keys arrive base64url-encoded; subscribe() needs raw bytes. */
function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const buffer = new ArrayBuffer(raw.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

  return buffer;
}

/** Current push state for this device. */
export async function pushStatus(): Promise<PushStatus> {
  if (!pushSupported()) {
    return { supported: false, permission: "default", subscribed: false };
  }

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();

  return { supported: true, permission: Notification.permission, subscribed: Boolean(sub) };
}

type EnablePushResult =
  { ok: true } | { ok: false; reason: "unsupported" | "denied" | "unconfigured" | "failed" };

/** Request permission, subscribe, and register the endpoint with the server. */
export async function enablePush(): Promise<EnablePushResult> {
  if (!pushSupported()) return { ok: false, reason: "unsupported" };

  const permission = await Notification.requestPermission();
  /* "denied" is a dead end — only the browser's site settings can undo it. */
  if (permission !== "granted") return { ok: false, reason: "denied" };

  const { key } = await api.push.publicKey();
  if (!key) return { ok: false, reason: "unconfigured" };

  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBuffer(key),
      }));

    const { endpoint, keys } = sub.toJSON() as {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    };
    await api.push.subscribe({ endpoint, keys });

    return { ok: true };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** Unsubscribe this device and drop the endpoint server-side. */
export async function disablePush(): Promise<boolean> {
  if (!pushSupported()) return false;

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return true;

  const { endpoint } = sub;
  await sub.unsubscribe();
  /* Drop the row even if unsubscribe already invalidated the endpoint. */
  await api.push.unsubscribe(endpoint).catch(() => {});

  return true;
}

/* Unlike the other preference toggles, a failure here is not silently reverted:
   a denied permission can only be undone in the browser's site settings. */
export const PUSH_FAILURE_NOTE: Record<string, string> = {
  unsupported:
    "This browser cannot receive push notifications. On iPhone or iPad, add Custos to your Home Screen first.",
  denied:
    "Notifications are blocked for this site. Allow them in your browser's site settings, then try again.",
  unconfigured: "Push notifications are not configured on this server yet.",
  failed: "Could not enable notifications. Please try again.",
};
