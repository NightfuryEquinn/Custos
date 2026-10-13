import { cachedPathsForAddress } from "./cipher-cache";
import { useEffect, useState } from "react";

/** How long to wait for the controlling worker to answer the shell check. */
const SHELL_CHECK_MS = 3000;

/** What the badge is waiting on: records, the installed app shell, or nothing. */
export type OfflinePrep = "ready" | "records" | "shell";

/** Shell answer from a controlling worker, or none when no worker controls the page. */
export type ShellState = "none" | "ready" | "missing";

/** True when every daily read, and this month's events, are in the local cache. */
export function hasDailyCache(paths: readonly string[], month: string): boolean {
  const required = [
    "/profile",
    "/wallets",
    "/categories",
    "/expenses",
    "/todo-lists",
    "/capital-plans",
    "/vehicles",
    "/vehicles/fills",
    "/daily/routines",
    "/daily/completions",
    "/nudges",
    "/users/me",
  ];
  return (
    required.every((prefix) =>
      paths.some((path) => path === prefix || path.startsWith(`${prefix}?`)),
    ) &&
    paths.some(
      (path) =>
        path.startsWith("/events?") &&
        new URLSearchParams(path.split("?")[1]).get("month") === month,
    )
  );
}

/**
 * Records ready, plus a shell that is either absent or cached.
 * A controlling worker that reports the shell missing stays incomplete.
 * No controller is not a failure: dev never registers one, and a production
 * worker may not have claimed the page yet.
 */
export function offlinePrep(
  dataReady: boolean,
  cacheReady: boolean,
  shell: ShellState,
): OfflinePrep {
  if (!dataReady || !cacheReady) return "records";
  if (shell === "missing") return "shell";

  return "ready";
}

/** Track whether this month's records and, when a worker controls the page, the app shell are cached. */
export function useOfflineReadiness(
  address: string,
  month: string,
  dataReady: boolean,
): OfflinePrep {
  const [prep, setPrep] = useState<OfflinePrep>("records");

  useEffect(() => {
    let cancelled = false;
    let generation = 0;
    let timer = 0;
    let port: MessagePort | null = null;

    /** Drop the in-flight shell reply so an older check cannot update state. */
    const closePort = () => {
      window.clearTimeout(timer);
      port?.close();
      port = null;
    };

    /** Re-read the cache and, when a worker controls the page, the shell. */
    const check = async () => {
      const id = ++generation;
      const current = () => !cancelled && id === generation;
      closePort();

      if (!dataReady) {
        if (current()) setPrep("records");
        return;
      }

      const paths = await cachedPathsForAddress(address);
      if (!current()) return;
      const cacheReady = hasDailyCache(paths, month);
      if (!cacheReady) {
        setPrep("records");
        return;
      }

      const controller = navigator.serviceWorker?.controller;
      if (!controller) {
        setPrep(offlinePrep(true, true, "none"));
        return;
      }

      const channel = new MessageChannel();
      port = channel.port1;
      let settled = false;

      /** Apply this check's shell answer, ignoring a timeout from an older check. */
      const finish = (shell: ShellState) => {
        if (settled || !current()) return;
        settled = true;
        closePort();
        setPrep(offlinePrep(true, true, shell));
      };

      timer = window.setTimeout(() => finish("missing"), SHELL_CHECK_MS);
      channel.port1.onmessage = (event) => {
        finish(event.data?.ready === true ? "ready" : "missing");
      };

      const script = document.querySelector<HTMLScriptElement>('script[src*="/chunk-"]');
      const entry = script ? new URL(script.src).pathname : undefined;
      try {
        controller.postMessage({ type: "CHECK_OFFLINE_READY", entry }, [channel.port2]);
      } catch {
        finish("missing");
      }
    };

    /** Run a check; a thrown read only counts if this attempt is still the latest. */
    const run = () => {
      const id = generation + 1;
      void check().catch(() => {
        if (!cancelled && id === generation) setPrep("records");
      });
    };

    run();
    window.addEventListener("custos-cache-changed", run);
    navigator.serviceWorker?.addEventListener("controllerchange", run);
    const poll = window.setInterval(run, 15_000);

    return () => {
      cancelled = true;
      closePort();
      window.clearInterval(poll);
      window.removeEventListener("custos-cache-changed", run);
      navigator.serviceWorker?.removeEventListener("controllerchange", run);
    };
  }, [address, month, dataReady]);

  return prep;
}
