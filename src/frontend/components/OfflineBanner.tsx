import { Icon } from "@/frontend/components/ui";
import { openConfirm } from "@/frontend/lib/feedback";
import { useNetworkStatus } from "@/frontend/lib/hooks/useNetworkStatus";
import { discardOutbox, retryOutbox } from "@/frontend/lib/sync/outbox";
import type { OutboxEntry } from "@/frontend/lib/sync/types";
import { useOutboxEntries, useReadableLabels } from "@/frontend/lib/sync/useOutbox";
import { useOfflineReadiness } from "@/frontend/lib/pwa/readiness";
import { drainOutbox } from "@/frontend/lib/sync/engine";
import { useEffect, useRef, useState } from "react";

/** How long to wait for a waiting worker to become the page controller. */
const UPDATE_TAKEOVER_MS = 4000;

/** True while an update click is waiting to see if that worker takes control. */
let updateRequested = false;

/** Reload after this waiting worker becomes the controller; otherwise drop the listener. */
function activateWaitingWorker(worker: ServiceWorker) {
  if (updateRequested) return;

  updateRequested = true;
  let settled = false;
  let timer = 0;

  /** Clear the takeover listeners, and reload only when this worker won. */
  const finish = (reload: boolean) => {
    if (settled) return;

    settled = true;
    updateRequested = false;
    window.clearTimeout(timer);
    navigator.serviceWorker.removeEventListener("controllerchange", onController);
    worker.removeEventListener("statechange", onState);
    if (reload) window.location.reload();
  };

  /** Reload once the page is controlled by the worker we asked to activate. */
  const onController = () => {
    if (navigator.serviceWorker.controller === worker) finish(true);
  };

  /** Reload when this worker activates; drop the listener if it is discarded. */
  const onState = () => {
    if (worker.state === "activated") finish(true);
    if (worker.state === "redundant") finish(false);
  };

  timer = window.setTimeout(() => {
    if (navigator.serviceWorker.controller !== worker) finish(false);
  }, UPDATE_TAKEOVER_MS);

  navigator.serviceWorker.addEventListener("controllerchange", onController);
  worker.addEventListener("statechange", onState);

  try {
    worker.postMessage({ type: "ACTIVATE_UPDATE" });
  } catch {
    finish(false);
  }
}

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
  const names = useReadableLabels(address, entries);
  /** The name to show: decrypted when the ledger is unlocked, otherwise the fixed word. */
  const nameOf = (entry: OutboxEntry) => names.get(entry.opId) || entry.label || entry.entity;
  const ready = useOfflineReadiness(address, month, dataReady);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [error, setError] = useState("");
  const changesRef = useRef<HTMLDetailsElement>(null);
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
  useEffect(() => {
    /** Close the changes panel when the pointer lands outside it. */
    const onPointerDown = (event: PointerEvent) => {
      const panel = changesRef.current;
      if (!panel?.open) return;
      if (event.target instanceof Node && panel.contains(event.target)) return;

      panel.open = false;
    };

    document.addEventListener("pointerdown", onPointerDown);

    return () => document.removeEventListener("pointerdown", onPointerDown);
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
      message: `"${nameOf(entry)}" has not synced to the server. Discarding it loses this change for good.${
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
      <details ref={changesRef} className="journal-sync-details">
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
                    {nameOf(entry)}
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
          onClick={() => activateWaitingWorker(waiting)}
        >
          Update ready / Reload
        </button>
      )}
    </div>
  );
}
