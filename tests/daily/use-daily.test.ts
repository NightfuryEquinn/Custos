import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ledgerKeyStore } from "@/frontend/lib/crypto/key-store";
import { useDaily } from "@/frontend/lib/hooks/useDaily";
import { connectivity } from "@/frontend/lib/net/connectivity";
import { enqueueOutbox, listOutbox } from "@/frontend/lib/sync/outbox";
import { fakeLocalStorage } from "../helpers/fake-storage";

const address = "0xabc0000000000000000000000000000000000002";
const routineId = "a".repeat(24);
const oldFetch = globalThis.fetch;

beforeEach(async () => {
  (globalThis as unknown as { localStorage: unknown }).localStorage = fakeLocalStorage();
  Object.defineProperty(globalThis.navigator, "onLine", { value: true, configurable: true });
  ledgerKeyStore.set(
    address,
    await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]),
  );
  /* Nothing may drain: the queue is what is under test. */
  globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = oldFetch;
  connectivity.setStatusForTests("online");
  ledgerKeyStore.clear(address);
});

test("editing or archiving a routine whose create is still queued waits for that create", async () => {
  const create = await enqueueOutbox({
    address,
    entity: "dailyRoutine",
    op: "create",
    targetId: routineId,
    request: { method: "POST", path: "/daily/routines", body: { id: routineId } },
    dependsOn: [],
  });
  let saveRoutine!: ReturnType<typeof useDaily>["saveRoutine"];
  function Probe() {
    saveRoutine = useDaily(address, true).saveRoutine;
    return null;
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderToString(createElement(QueryClientProvider, { client }, createElement(Probe)));

  await saveRoutine({
    id: routineId,
    title: "Gym",
    notes: "",
    schedule: [{ from: "2026-10-12", kind: "daily" }],
    archivedOn: "2026-10-12",
    createdAt: "2026-10-12T08:00:00.000Z",
  });

  const update = (await listOutbox(address)).find(
    (e) => e.entity === "dailyRoutine" && e.op === "update",
  );
  expect(update?.dependsOn).toEqual([create.opId]);
  client.clear();
});
