/**
 * Shared connectivity signal — a framework-free store, not a React context,
 * because it must be readable by non-React code (the API layer, the offline
 * write queue) and by Root.tsx's boot sequence before any provider mounts.
 *
 * `navigator.onLine` alone is unreliable (a captive portal reports "online"
 * with no real internet reachable), so this combines three signals:
 *
 * 1. Passive observation — `api.ts`'s `request()` calls `observe()` on every
 *    real outcome: any HTTP response at all (even non-2xx) means the network
 *    is fine; a `TypeError`/timeout means it isn't. This is free (no extra
 *    traffic) and defeats the captive-portal case on its own.
 * 2. `online`/`offline` window events — `offline` is trustworthy immediately;
 *    `online` is not (it can fire on a captive portal), so it only triggers
 *    a re-probe rather than an immediate "online" status.
 * 3. An active probe (`HEAD /manifest.webmanifest`) with backoff, run only
 *    while offline/checking, to detect reconnection promptly rather than
 *    waiting for the next real API call.
 */

export type NetStatus = "online" | "offline" | "checking";

const PROBE_PATH = "/manifest.webmanifest";
const PROBE_TIMEOUT_MS = 4_000;
const PROBE_DELAYS_MS = [5_000, 10_000, 30_000, 60_000];

type Listener = () => void;

function createConnectivityStore() {
  let status: NetStatus =
    typeof navigator === "undefined" || navigator.onLine ? "online" : "offline";
  const listeners = new Set<Listener>();
  let probeTimer: ReturnType<typeof setTimeout> | undefined;
  let probeAttempt = 0;
  let inFlightProbe: Promise<NetStatus> | null = null;

  function notify() {
    for (const fn of listeners) fn();
  }

  function setStatus(next: NetStatus) {
    if (next === status) return;
    status = next;
    notify();
    if (status === "offline" || status === "checking") armProbe();
    else clearProbe();
  }

  function clearProbe() {
    clearTimeout(probeTimer);
    probeTimer = undefined;
    probeAttempt = 0;
  }

  function armProbe() {
    clearTimeout(probeTimer);
    if (typeof document !== "undefined" && document.hidden) return;
    const delay = PROBE_DELAYS_MS[Math.min(probeAttempt, PROBE_DELAYS_MS.length - 1)]!;
    probeTimer = setTimeout(() => {
      void probe();
    }, delay);
  }

  async function probe(): Promise<NetStatus> {
    if (inFlightProbe) return inFlightProbe;

    inFlightProbe = (async () => {
      try {
        await fetch(`${PROBE_PATH}?t=${Date.now()}`, {
          method: "HEAD",
          cache: "no-store",
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        setStatus("online");
      } catch {
        probeAttempt++;
        setStatus("offline");
      } finally {
        inFlightProbe = null;
      }
      return status;
    })();

    return inFlightProbe;
  }

  if (typeof window !== "undefined") {
    window.addEventListener("offline", () => setStatus("offline"));
    window.addEventListener("online", () => {
      setStatus("checking");
      void probe();
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && (status === "offline" || status === "checking")) void probe();
    });
  }

  return {
    get(): NetStatus {
      return status;
    },
    isOnline(): boolean {
      return status !== "offline";
    },
    subscribe(fn: Listener): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Passive signal fed by api.ts on every request outcome. */
    observe(outcome: "reached-server" | "network-failure"): void {
      if (outcome === "reached-server") {
        setStatus("online");
        return;
      }
      if (status === "online") {
        setStatus("checking");
        void probe();
      }
    },
    /** Active probe; returns the resolved status. */
    probe(): Promise<NetStatus> {
      return probe();
    },
    /** Test helper: force a status directly, bypassing the probe. */
    setStatusForTests(next: NetStatus): void {
      clearProbe();
      status = next;
      notify();
    },
  };
}

export const connectivity = createConnectivityStore();
