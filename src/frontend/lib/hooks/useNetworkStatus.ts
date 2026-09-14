import { useSyncExternalStore } from "react";
import { connectivity, type NetStatus } from "@/frontend/lib/net/connectivity";

/** React view over the shared connectivity store (`src/frontend/lib/net/connectivity.ts`). */
export function useNetworkStatus(): { status: NetStatus; isOnline: boolean; isOffline: boolean } {
  const status = useSyncExternalStore(connectivity.subscribe, connectivity.get, connectivity.get);

  return { status, isOnline: status !== "offline", isOffline: status === "offline" };
}
