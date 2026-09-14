import { Icon } from "@/frontend/components/ui";
import { useNetworkStatus } from "@/frontend/lib/hooks/useNetworkStatus";
import { discardOutbox, retryOutbox } from "@/frontend/lib/sync/outbox";
import { useFailedOutboxEntries, useSyncStatus } from "@/frontend/lib/sync/useOutbox";
import { useEffect, useRef, useState } from "react";

const BACK_ONLINE_DISPLAY_MS = 5_000;

/** Permanently-failed entries never disappear or auto-retry silently — the
 *  user sees each one and chooses Retry or Discard. */
function FailedSyncPanel({ address, onClose }: { address: string; onClose: () => void }) {
  const failed = useFailedOutboxEntries(address);

  useEffect(() => {
    if (failed.length === 0) onClose();
  }, [failed.length, onClose]);

  return (
    <div className="offline-failed-panel" role="dialog" aria-label="Changes that couldn't sync">
      <div className="offline-failed-head">
        <span>Couldn't sync</span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="close" size={16} />
        </button>
      </div>
      <ul className="offline-failed-list">
        {failed.map((entry) => (
          <li key={entry.opId} className="offline-failed-row">
            <span className="offline-failed-label">{entry.label || entry.entity}</span>
            <span className="offline-failed-actions">
              <button
                type="button"
                className="mini-btn"
                onClick={() => void retryOutbox(entry.opId)}
              >
                Retry
              </button>
              <button
                type="button"
                className="mini-btn"
                onClick={() => void discardOutbox(entry.opId)}
              >
                Discard
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Connectivity + pending-sync indicator for the topbar. Three states:
 *  - offline: visible continuously while the app has no network (also shows
 *    the pending-sync count, once there's anything queued).
 *  - just reconnected: briefly shows "Back online" on the offline→online
 *    transition, then hides itself.
 *  - steady-state online with nothing pending: nothing rendered.
 * A permanent-failure count, when present, opens a small retry/discard panel.
 */
export function OfflineBanner({ address }: { address: string }) {
  const { status } = useNetworkStatus();
  const { pending, failed } = useSyncStatus(address);
  const [showBackOnline, setShowBackOnline] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const wasOffline = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (status === "offline") {
      wasOffline.current = true;
      setShowBackOnline(false);
      clearTimeout(hideTimer.current);
      return;
    }
    if (status === "online" && wasOffline.current) {
      wasOffline.current = false;
      setShowBackOnline(true);
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setShowBackOnline(false), BACK_ONLINE_DISPLAY_MS);
    }
  }, [status]);

  useEffect(() => () => clearTimeout(hideTimer.current), []);

  if (status === "offline") {
    return (
      <span className="offline-banner offline-banner--offline" role="status">
        <Icon name="wifi-off" size={15} /> Offline
        {pending > 0 ? ` · ${pending} pending` : ""}
      </span>
    );
  }

  if (failed > 0) {
    return (
      <>
        <button
          type="button"
          className="offline-banner offline-banner--offline offline-banner--button"
          onClick={() => setPanelOpen(true)}
        >
          <Icon name="wifi-off" size={15} /> {failed} change{failed === 1 ? "" : "s"} couldn't sync
        </button>
        {panelOpen && <FailedSyncPanel address={address} onClose={() => setPanelOpen(false)} />}
      </>
    );
  }

  if (showBackOnline) {
    return (
      <span className="offline-banner offline-banner--online" role="status">
        <Icon name="wifi-on" size={15} /> Back online
      </span>
    );
  }

  return null;
}
