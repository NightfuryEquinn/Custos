import { api } from "@/frontend/lib/api";
import { useEffect, useState } from "react";
import { writeCachedBudgetAlertsEnabled } from "@/frontend/lib/hooks/useBudgetAlertsEnabled";

export const NOTIFY_EMAIL_CHANGED = "ledger:notify-email-changed";
const NOTIFY_EMAIL_KEY = "ledger:notifyEmail";

/** Tell open views to reload the account notify email from the server. */
export function emitNotifyEmailChanged(): void {
  window.dispatchEvent(new Event(NOTIFY_EMAIL_CHANGED));
}

/** Read cached notify email from localStorage (warm UI before /users/me). */
export function readCachedNotifyEmail(): string {
  try {
    return localStorage.getItem(NOTIFY_EMAIL_KEY)?.trim() || "";
  } catch {
    return "";
  }
}

/** Persist notify email locally so restore-after-PWA-clear can warm the field. */
export function writeCachedNotifyEmail(email: string): void {
  try {
    if (email) localStorage.setItem(NOTIFY_EMAIL_KEY, email);
    else localStorage.removeItem(NOTIFY_EMAIL_KEY);
  } catch {
    /* ignore quota / private mode */
  }
}

/** Load the account notify email and refresh after Data & privacy saves it. */
export function useAccountNotifyEmail(): string {
  const [email, setEmail] = useState(() => readCachedNotifyEmail());

  useEffect(() => {
    let cancelled = false;

    /** Fetch notify email from the server and refresh local cache. */
    const load = () => {
      void api.users
        .me()
        .then(({ user }) => {
          const next = user.notifyEmail?.trim() || "";
          writeCachedNotifyEmail(next);
          writeCachedBudgetAlertsEnabled(user.budgetAlertsEnabled !== false);
          if (!cancelled) setEmail(next);
        })
        .catch(() => {
          /* Keep the warm cache when the network is unavailable. */
        });
    };

    load();
    window.addEventListener(NOTIFY_EMAIL_CHANGED, load);

    return () => {
      cancelled = true;
      window.removeEventListener(NOTIFY_EMAIL_CHANGED, load);
    };
  }, []);

  return email;
}
