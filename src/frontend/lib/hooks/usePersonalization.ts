import { useEffect, useState, useCallback } from "react";
import { personalSnapshot, syncPersonalization, recordBehaviour } from "../personalization-client";
export function usePersonalization(address: string, view?: string) {
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof personalSnapshot>> | null>(
    null,
  );
  const [error, setError] = useState("");
  const manageSync = view !== undefined;
  useEffect(() => {
    let active = true;
    const load = () => {
      void personalSnapshot(address)
        .then((s) => {
          if (active) setSnapshot(s);
        })
        .catch(() => {});
    };
    const sync = () => {
      void syncPersonalization(address)
        .then(() => {
          if (active) setError("");
        })
        .catch(() => {
          if (active)
            setError(
              "History sync unavailable. Local suggestions remain available; pending deletion will retry online.",
            );
        });
    };
    load();
    if (manageSync) sync();
    const timer = manageSync ? setInterval(sync, 60000) : undefined;
    window.addEventListener("personalization-changed", load);
    window.addEventListener("storage", load);
    if (manageSync) {
      window.addEventListener("online", sync);
      window.addEventListener("focus", sync);
    }
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("personalization-changed", load);
      window.removeEventListener("storage", load);
      window.removeEventListener("online", sync);
      window.removeEventListener("focus", sync);
    };
  }, [address, manageSync]);

  useEffect(() => {
    if (view && snapshot?.pref.enabled) void recordBehaviour(address, "visited", view);
  }, [address, view, snapshot?.pref.enabled]);
  return { snapshot, error, refresh: useCallback(() => syncPersonalization(address), [address]) };
}
