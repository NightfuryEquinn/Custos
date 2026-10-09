import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ledgerKeyStore } from "@/frontend/lib/crypto/key-store";
import { CURRENT_MONTH_KEY } from "@/frontend/lib/data";
import { useLedger } from "@/frontend/lib/hooks/useLedger";
import { connectivity } from "@/frontend/lib/net/connectivity";
import type { LedgerEvent } from "@/frontend/lib/types";
import { fakeLocalStorage } from "../helpers/fake-storage";

const address = "0xabc0000000000000000000000000000000000003";
const oldFetch = globalThis.fetch;

beforeEach(async () => {
  const storage = fakeLocalStorage();
  storage.setItem(`custos:month:${address}`, "2020-01"); // the person has paged back to an old month
  (globalThis as unknown as { localStorage: unknown }).localStorage = storage;
  Object.defineProperty(globalThis.navigator, "onLine", { value: true, configurable: true });
  ledgerKeyStore.set(
    address,
    await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]),
  );
  globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = oldFetch;
  connectivity.setStatusForTests("online");
  ledgerKeyStore.clear(address);
});

test("Home's events are this month's, even while another month is selected", () => {
  const today = { id: "e1", title: "Dentist" } as unknown as LedgerEvent;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["events", address, CURRENT_MONTH_KEY], [today]);
  let ledger!: ReturnType<typeof useLedger>;
  function Probe() {
    ledger = useLedger(address);
    return null;
  }

  renderToString(createElement(QueryClientProvider, { client }, createElement(Probe)));

  expect(ledger.month).toBe("2020-01");
  expect(ledger.events).toEqual([]); // the Schedule page still follows the selected month
  expect(ledger.homeEvents).toEqual([today]);
  client.clear();
});
