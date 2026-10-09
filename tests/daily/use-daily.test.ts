import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ledgerKeyStore } from "@/frontend/lib/crypto/key-store";
import { useDaily } from "@/frontend/lib/hooks/useDaily";
import { connectivity } from "@/frontend/lib/net/connectivity";
import { openLabel } from "@/frontend/lib/sync/labels";
import { enqueueOutbox, listOutbox } from "@/frontend/lib/sync/outbox";
import { currentPeriod, type DailyRoutine } from "@/lib/daily";
import { zonedTodayIso } from "@/lib/recurring";
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

describe("setDone", () => {
  const tz = "Asia/Kuala_Lumpur";
  const routine: DailyRoutine = {
    id: routineId,
    title: "Take medication",
    notes: "private note",
    schedule: [{ from: "2000-01-03", kind: "daily" }],
    createdAt: "2000-01-03T00:00:00.000Z",
  };

  /** Mount the hook with the account timezone already known, as it is once /users/me has loaded. */
  function mount() {
    const state = {} as { daily: ReturnType<typeof useDaily> };
    function Probe() {
      state.daily = useDaily(address, true);
      return null;
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["daily-timezone", address], tz);
    renderToString(createElement(QueryClientProvider, { client }, createElement(Probe)));
    return { state, client };
  }

  test("a tick for a day that is no longer today is refused and queues nothing", async () => {
    const { state, client } = mount();

    await expect(state.daily.setDone(routine, true, "2000-01-03")).rejects.toThrow(/day changed/i);

    expect((await listOutbox(address)).filter((e) => e.entity === "dailyCompletion")).toEqual([]);
    client.clear();
  });

  test("a tick for the period on screen is queued under that period", async () => {
    const { state, client } = mount();
    const period = currentPeriod(routine, zonedTodayIso(tz))!;

    await state.daily.setDone(routine, true, period);

    const queued = (await listOutbox(address)).filter((e) => e.entity === "dailyCompletion");
    expect(queued.map((e) => e.targetId)).toEqual([`${routineId}:${period}`]);
    client.clear();
  });

  test("nothing readable about a routine is left in the outbox", async () => {
    const { state, client } = mount();
    await state.daily.saveRoutine({ ...routine, id: undefined });
    await state.daily.setDone(routine, true, currentPeriod(routine, zonedTodayIso(tz))!);

    const queued = await listOutbox(address);
    const everything = JSON.stringify(queued);
    expect(everything).not.toContain("Take medication");
    expect(everything).not.toContain("private note");
    /* ...yet the sync banner can still name the routine, from the encrypted copy. */
    const key = ledgerKeyStore.get(address)!;
    const names = await Promise.all(queued.map((e) => openLabel(e, key)));
    expect(names).toContain("Take medication");
    client.clear();
  });
});
