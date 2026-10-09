import { cachedPathsForAddress } from "./cipher-cache";
import { useEffect, useState } from "react";

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

export function useOfflineReadiness(address: string, month: string, dataReady: boolean) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    const check = async () => {
      const controller = navigator.serviceWorker?.controller;
      if (!controller || !dataReady) {
        if (!cancelled) setReady(false);
        return;
      }
      const paths = await cachedPathsForAddress(address);
      if (cancelled) return;
      const channel = new MessageChannel();
      const timer = setTimeout(() => {
        channel.port1.close();
        if (!cancelled) setReady(false);
      }, 3000);
      channel.port1.onmessage = (event) => {
        clearTimeout(timer);
        channel.port1.close();
        if (!cancelled) setReady(event.data?.ready === true && hasDailyCache(paths, month));
      };
      const script = document.querySelector<HTMLScriptElement>('script[src*="/chunk-"]');
      const entry = script ? new URL(script.src).pathname : undefined;
      controller.postMessage({ type: "CHECK_OFFLINE_READY", entry }, [channel.port2]);
    };
    const run = () => {
      void check().catch(() => {
        if (!cancelled) setReady(false);
      });
    };
    run();
    window.addEventListener("custos-cache-changed", run);
    navigator.serviceWorker?.addEventListener("controllerchange", run);
    const timer = setInterval(run, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("custos-cache-changed", run);
      navigator.serviceWorker?.removeEventListener("controllerchange", run);
    };
  }, [address, month, dataReady]);
  return ready;
}
