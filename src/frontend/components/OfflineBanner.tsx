import { Icon } from "@/frontend/components/ui";
import { useNetworkStatus } from "@/frontend/lib/hooks/useNetworkStatus";
import { useEffect, useRef, useState } from "react";

const BACK_ONLINE_DISPLAY_MS = 5_000;

/**
 * Connectivity indicator for the topbar. Three states:
 *  - offline: visible continuously while the app has no network.
 *  - just reconnected: briefly shows "Back online" on the offline→online
 *    transition, then hides itself.
 *  - steady-state online: nothing rendered.
 */
export function OfflineBanner() {
  const { status } = useNetworkStatus();
  const [showBackOnline, setShowBackOnline] = useState(false);
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
      </span>
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
