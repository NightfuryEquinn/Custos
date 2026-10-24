import { useEffect, useMemo, useState } from "react";
import { ledgerKeyStore } from "@/frontend/lib/crypto/key-store";
import { usePendingOverlay } from "@/frontend/lib/sync/useOutbox";
import { expenseOverlay, eventOverlay, vehicleFillOverlay } from "@/frontend/lib/sync/overlay";
import { buildSearchDocuments, type SearchHistory, type SearchLedger } from "./documents";
import { mergeRecords } from "./model";
import { loadSearchHistory } from "./history";
import { subscribeOutbox } from "@/frontend/lib/sync/outbox";

/** Search state exists only while the dialog is mounted; ciphertext remains in the normal cache. */
export function useSearchData(address: string, ledger: SearchLedger) {
  const [history, setHistory] = useState<SearchHistory>({
    expenses: [],
    events: [],
    fills: [],
    checkIns: [],
  });
  const [loading, setLoading] = useState(true);
  const [complete, setComplete] = useState<Partial<Record<keyof SearchHistory, boolean>>>({});
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [attempt, retry] = useState(0);
  const nudgeIds = ledger.nudges.nudges
    .map((row) => row.id)
    .sort()
    .join(",");
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const unsubscribe = subscribeOutbox(() => {
      clearTimeout(timer);
      timer = setTimeout(() => retry((value) => value + 1), 400);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setUnavailable([]);
    setComplete({});
    setHistory({ expenses: [], events: [], fills: [], checkIns: [] });
    void loadSearchHistory(
      address,
      nudgeIds.split(",").filter(Boolean),
      (page) => {
        if (cancelled) return;
        setHistory((previous) => ({
          expenses: mergeRecords(previous.expenses, page.expenses ?? []),
          events: mergeRecords(previous.events, page.events ?? []),
          fills: mergeRecords(previous.fills, page.fills ?? []),
          checkIns: mergeRecords(previous.checkIns, page.checkIns ?? []),
        }));
      },
      () => cancelled,
      (resource) => {
        if (!cancelled) setComplete((previous) => ({ ...previous, [resource]: true }));
      },
    )
      .then((missing) => {
        if (!cancelled) {
          setUnavailable(missing);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUnavailable(["history"]);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [address, nudgeIds, attempt]);
  const key = ledgerKeyStore.get(address);
  const expenseBase = useMemo(
    () =>
      complete.expenses ? history.expenses : mergeRecords(ledger.accountExpenses, history.expenses),
    [history.expenses, ledger.accountExpenses, complete.expenses],
  );
  const eventBase = useMemo(
    () => (complete.events ? history.events : mergeRecords(ledger.events, history.events)),
    [history.events, ledger.events, complete.events],
  );
  const fillBase = useMemo(
    () => (complete.fills ? history.fills : mergeRecords(ledger.vehicleFills, history.fills)),
    [history.fills, ledger.vehicleFills, complete.fills],
  );
  const expenses = usePendingOverlay(address, expenseBase, key, expenseOverlay);
  const events = usePendingOverlay(address, eventBase, key, eventOverlay);
  const fills = usePendingOverlay(address, fillBase, key, vehicleFillOverlay);
  const data = useMemo(
    () => ({
      expenses,
      events,
      fills,
      checkIns: mergeRecords(history.checkIns, ledger.nudges.pendingEvents),
    }),
    [expenses, events, fills, history.checkIns, ledger.nudges.pendingEvents],
  );
  const documents = useMemo(() => buildSearchDocuments(ledger, data), [ledger, data]);
  return {
    data,
    documents,
    loading,
    unavailable: [...new Set([...unavailable, ...ledger.unavailableResources])],
    retry: () => retry((value) => value + 1),
  };
}
