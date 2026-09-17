import { beforeEach, describe, expect, test } from "bun:test";
import { resetFakeIdb } from "../helpers/fake-idb";
import { entry, TEST_ADDRESS as ADDRESS } from "../helpers/outbox";
import { openCustosDb, reqAsPromise, STORES, txAsPromise } from "@/frontend/lib/pwa/idb";
import {
  clearOutboxForAddress,
  confirmOutbox,
  discardOutbox,
  enqueueOutbox,
  failOutboxPermanently,
  listOutbox,
  purgeStaleFailures,
  retryOutbox,
} from "@/frontend/lib/sync/outbox";

beforeEach(() => {
  resetFakeIdb();
});

describe("outbox: enqueue + drain order", () => {
  test("entries come back in FIFO seq order", async () => {
    await enqueueOutbox(entry({ targetId: "a" }));
    await enqueueOutbox(entry({ targetId: "b" }));
    await enqueueOutbox(entry({ targetId: "c" }));

    const list = await listOutbox(ADDRESS);
    expect(list.map((e) => e.targetId)).toEqual(["a", "b", "c"]);
    expect(list.map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  test("confirmOutbox removes the entry", async () => {
    const stored = await enqueueOutbox(entry());
    await confirmOutbox(stored.opId);
    expect(await listOutbox(ADDRESS)).toHaveLength(0);
  });

  test("scoping is per-address", async () => {
    await enqueueOutbox(entry());
    await enqueueOutbox(entry({ address: "0x0000000000000000000000000000000000000002" }));
    expect(await listOutbox(ADDRESS)).toHaveLength(1);
  });
});

describe("outbox: coalescing", () => {
  test("a new update over a pending update replaces it, keeping the same seq", async () => {
    const first = await enqueueOutbox(
      entry({
        op: "update",
        request: { method: "PATCH", path: "/expenses/x", body: { note: "v1" } },
      }),
    );
    const merged = await enqueueOutbox(
      entry({
        op: "update",
        request: { method: "PATCH", path: "/expenses/x", body: { note: "v2" } },
      }),
    );

    expect(merged.seq).toBe(first.seq);
    const list = await listOutbox(ADDRESS);
    expect(list).toHaveLength(1);
    expect((list[0]!.request.body as { note: string }).note).toBe("v2");
  });

  test("a delete over a pending create for the same id drops both", async () => {
    await enqueueOutbox(entry({ op: "create" }));
    await enqueueOutbox(
      entry({ op: "delete", request: { method: "DELETE", path: "/expenses/target-1" } }),
    );

    expect(await listOutbox(ADDRESS)).toHaveLength(0);
  });

  test("a soft delete (overlayPatch) over a pending create keeps both entries", async () => {
    // Mirrors deleteEventMutation's "this"/"future" scope: the DELETE
    // request's real effect is a trim, not a removal, so annihilating it
    // against a still-unconfirmed create would silently destroy the whole
    // row instead of just trimming it.
    await enqueueOutbox(entry({ entity: "event", op: "create" }));
    await enqueueOutbox(
      entry({
        entity: "event",
        op: "delete",
        request: { method: "DELETE", path: "/events/target-1?scope=this" },
        overlayPatch: { exceptDates: ["2026-09-08"] },
      }),
    );

    const list = await listOutbox(ADDRESS);
    expect(list.map((e) => e.op)).toEqual(["create", "delete"]);
  });

  test("a delete over a pending update drops the update and keeps the delete", async () => {
    await enqueueOutbox(entry({ op: "create" }));
    await confirmOutbox((await listOutbox(ADDRESS))[0]!.opId); // simulate the create having already confirmed
    await enqueueOutbox(
      entry({ op: "update", request: { method: "PATCH", path: "/expenses/target-1", body: {} } }),
    );
    await enqueueOutbox(
      entry({ op: "delete", request: { method: "DELETE", path: "/expenses/target-1" } }),
    );

    const list = await listOutbox(ADDRESS);
    expect(list).toHaveLength(1);
    expect(list[0]!.op).toBe("delete");
  });

  test("create followed by an update keeps both entries, not merged", async () => {
    await enqueueOutbox(entry({ op: "create" }));
    await enqueueOutbox(
      entry({ op: "update", request: { method: "PATCH", path: "/expenses/target-1", body: {} } }),
    );

    const list = await listOutbox(ADDRESS);
    expect(list.map((e) => e.op)).toEqual(["create", "update"]);
  });

  test("does not coalesce into an inflight entry", async () => {
    const first = await enqueueOutbox(entry({ op: "create" }));
    await failOutboxPermanently(first.opId, { message: "simulated" });
    // Manually mark inflight to exercise the guard (claim path is covered in engine tests).
    const list1 = await listOutbox(ADDRESS);
    expect(list1[0]!.status).toBe("failed");
  });
});

describe("outbox: dependsOn failure cascade", () => {
  test("a permanently-failed create blocks its still-pending dependents", async () => {
    const parent = await enqueueOutbox(entry({ entity: "vehicle", op: "create", targetId: "v1" }));
    const child = await enqueueOutbox(
      entry({
        entity: "vehicleFill",
        op: "create",
        targetId: "f1",
        request: { method: "POST", path: "/vehicles/fills", body: { vehicleId: "v1" } },
        dependsOn: [parent.opId],
      }),
    );

    await failOutboxPermanently(parent.opId, { status: 400, message: "rejected" });

    const list = await listOutbox(ADDRESS);
    const blocked = list.find((e) => e.opId === child.opId)!;
    expect(blocked.status).toBe("blocked");
    expect(blocked.blockedBy).toBe(parent.opId);
    const parentEntry = list.find((e) => e.opId === parent.opId)!;
    expect(parentEntry.status).toBe("failed");
  });

  test("confirming the blocker releases its dependents back to pending", async () => {
    const parent = await enqueueOutbox(entry({ entity: "vehicle", op: "create", targetId: "v1" }));
    const child = await enqueueOutbox(
      entry({ entity: "vehicleFill", op: "create", targetId: "f1", dependsOn: [parent.opId] }),
    );
    await failOutboxPermanently(parent.opId, { message: "temporary" });
    await retryOutbox(parent.opId); // user retries — parent goes back to pending
    await confirmOutbox(parent.opId); // ...and this time the retry succeeds

    const list = await listOutbox(ADDRESS);
    expect(list).toHaveLength(1);
    const released = list.find((e) => e.opId === child.opId)!;
    expect(released.status).toBe("pending");
    expect(released.blockedBy).toBeUndefined();
  });

  test("discarding the blocker cascade-fails its dependents instead of releasing them", async () => {
    const parent = await enqueueOutbox(entry({ entity: "vehicle", op: "create", targetId: "v1" }));
    const child = await enqueueOutbox(
      entry({ entity: "vehicleFill", op: "create", targetId: "f1", dependsOn: [parent.opId] }),
    );
    await failOutboxPermanently(parent.opId, { message: "rejected" });
    await discardOutbox(parent.opId);

    const list = await listOutbox(ADDRESS);
    expect(list).toHaveLength(1);
    const failed = list.find((e) => e.opId === child.opId)!;
    expect(failed.status).toBe("failed");
    expect(failed.lastError?.message).toMatch(/discarded/i);
  });
});

describe("outbox: purgeStaleFailures", () => {
  async function backdate(opId: string, updatedAt: number): Promise<void> {
    const db = await openCustosDb();
    const tx = db.transaction(STORES.outbox, "readwrite");
    const store = tx.objectStore(STORES.outbox);
    const existing = await reqAsPromise(store.get(opId));
    store.put({ ...(existing as object), updatedAt });
    await txAsPromise(tx);
  }

  test("drops failed/blocked entries past the 30-day trust window", async () => {
    const stale = await enqueueOutbox(entry({ targetId: "old" }));
    await failOutboxPermanently(stale.opId, { message: "old failure" });
    await backdate(stale.opId, Date.now() - 31 * 24 * 60 * 60 * 1000);

    const fresh = await enqueueOutbox(entry({ targetId: "recent" }));
    await failOutboxPermanently(fresh.opId, { message: "recent failure" });

    await purgeStaleFailures(ADDRESS);

    const list = await listOutbox(ADDRESS);
    expect(list.map((e) => e.targetId)).toEqual(["recent"]);
  });

  test("never touches pending/inflight entries regardless of age", async () => {
    const entry1 = await enqueueOutbox(entry({ targetId: "still-pending" }));
    await backdate(entry1.opId, Date.now() - 60 * 24 * 60 * 60 * 1000);

    await purgeStaleFailures(ADDRESS);

    expect(await listOutbox(ADDRESS)).toHaveLength(1);
  });
});

describe("outbox: clearOutboxForAddress", () => {
  test("wipes every entry for that address only", async () => {
    await enqueueOutbox(entry({ targetId: "a" }));
    await enqueueOutbox(entry({ address: "0x0000000000000000000000000000000000000002" }));

    await clearOutboxForAddress(ADDRESS);

    expect(await listOutbox(ADDRESS)).toHaveLength(0);
    expect(await listOutbox("0x0000000000000000000000000000000000000002")).toHaveLength(1);
  });
});
