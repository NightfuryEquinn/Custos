import { Icon } from "@/frontend/components/ui";
import { openConfirm } from "@/frontend/lib/feedback";
import { useNetworkStatus } from "@/frontend/lib/hooks/useNetworkStatus";
import { discardOutbox, retryOutbox } from "@/frontend/lib/sync/outbox";
import type { OutboxEntry } from "@/frontend/lib/sync/types";
import { useOutboxEntries } from "@/frontend/lib/sync/useOutbox";
import { useOfflineReadiness } from "@/frontend/lib/pwa/readiness";
import { drainOutbox } from "@/frontend/lib/sync/engine";
import { useEffect, useState } from "react";

export function OfflineBanner({
  address,
  month,
  dataReady,
  saving,
}: {
  address: string;
  month: string;
  dataReady: boolean;
  saving: boolean;
}) {
  const { status } = useNetworkStatus();
  const entries = useOutboxEntries(address);
  const ready = useOfflineReadiness(address, month, dataReady);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [error, setError] = useState("");
  const failed = entries.some((e) => e.status === "failed" || e.status === "blocked");
  const syncing = entries.some((e) => e.status === "inflight");
  const label = failed
    ? "Needs attention"
    : entries.length
      ? syncing
        ? "Syncing"
        : "Saved on device"
      : "Synced";
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;
    let registration: ServiceWorkerRegistration | undefined;
    let installing: ServiceWorker | null = null;
    const check = () => {
      if (!cancelled) setWaiting(registration?.waiting ?? null);
      if (registration?.installing && installing !== registration.installing) {
        installing?.removeEventListener("statechange", check);
        installing = registration.installing;
        installing.addEventListener("statechange", check);
      }
    };
    void navigator.serviceWorker.getRegistration().then((reg) => {
      if (cancelled) return;
      registration = reg;
      check();
      reg?.addEventListener("updatefound", check);
    });
    return () => {
      cancelled = true;
      registration?.removeEventListener("updatefound", check);
      installing?.removeEventListener("statechange", check);
    };
  }, []);
  const retry = async (id: string) => {
    setError("");
    try {
      await retryOutbox(id);
      void drainOutbox(address);
    } catch {
      setError("Could not retry this change. Try again.");
    }
  };
  /** Ask first; a failure shows inline in the confirm dialog. */
  const confirmDiscard = (entry: OutboxEntry) => {
    /* discardOutbox deletes only this entry; changes blocked on it turn to "failed". */
    const dependents = entries.filter(
      (e) => e.status === "blocked" && e.blockedBy === entry.opId,
    ).length;
    setError("");
    openConfirm({
      title: "Discard Offline Changes",
      message: `"${entry.label || entry.entity}" has not synced to the server. Discarding it loses this change for good.${
        dependents
          ? ` ${dependents} other change${dependents === 1 ? " that depends" : "s that depend"} on it will then need attention too.`
          : ""
      }`,
      confirmLabel: "Discard",
      pendingLabel: "Discarding…",
      onConfirm: () => discardOutbox(entry.opId),
    });
  };
  return (
    <div className="journal-sync">
      <details className="journal-sync-details">
        <summary className="offline-banner">
          <Icon name={status === "offline" ? "wifi-off" : "lock"} size={15} />
          <span>
            {status === "offline" ? "Offline / " : ""}
            {label}
            {entries.length ? ` / ${entries.length}` : ""}
          </span>
        </summary>
        <div className="journal-sync-panel">
          <h3>Your changes</h3>
          <p className="journal-note">
            {ready
              ? "This month and daily tools are ready offline."
              : "Offline preparation is incomplete. Connect and wait for your records to finish loading."}
          </p>
          <p className="journal-note">
            {status === "offline"
              ? "Keep going. Changes sync when you reconnect and open Custos."
              : "Pending changes sync automatically. An expired session requires signing in again."}
          </p>
          {entries.length ? (
            <ul>
              {entries.map((entry) => (
                <li key={entry.opId}>
                  <span>
                    {entry.label || entry.entity}
                    <small>
                      {entry.status === "inflight"
                        ? "Syncing"
                        : entry.status === "pending"
                          ? "Saved on device"
                          : entry.status === "blocked"
                            ? "Waiting for a related change"
                            : "Needs attention"}
                    </small>
                  </span>
                  {(entry.status === "failed" || entry.status === "blocked") && (
                    <span className="offline-failed-actions">
                      <button
                        type="button"
                        className="mini-btn"
                        disabled={status === "offline" || entry.status === "blocked"}
                        onClick={() => void retry(entry.opId)}
                      >
                        Retry
                      </button>
                      <button
                        type="button"
                        className="mini-btn"
                        onClick={() => confirmDiscard(entry)}
                      >
                        Discard
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>All changes synced.</p>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
      </details>
      <span className="journal-readiness" role="status">
        {ready ? "Ready offline" : "Offline preparation incomplete"}
      </span>
      {waiting && (
        <button
          type="button"
          className="link-btn"
          disabled={saving}
          onClick={() => {
            navigator.serviceWorker.addEventListener(
              "controllerchange",
              () => window.location.reload(),
              { once: true },
            );
            waiting.postMessage({ type: "ACTIVATE_UPDATE" });
          }}
        >
          Update ready / Reload
        </button>
      )}
    </div>
  );
}
