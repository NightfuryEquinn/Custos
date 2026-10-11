import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { COLLECTIONS } from "@/db";
import { zonedLocalToUtcMs } from "@/lib/timezone";
import { OWNED_BY_ACCOUNT_ID } from "../../scripts/lib/purge-account";
import { ObjectId } from "mongodb";
import { installMemoryDb, uninstallMemoryDb, type MemoryDb } from "../helpers/memory-db";

/*
 * The cron sends a nudge once per slot and only moves forward: a goal that is met for
 * the day, a slot the cron reached too late, and a nudge with no readable copy are
 * advanced past without a push going out.
 */

const TZ = "Asia/Kuala_Lumpur";
const ACCOUNT_ID = "64b64c4f2f1c2e0012345678";
const MIN = 60_000;

/** Payloads captured per run instead of hitting a push service. */
const pushSends: { endpoint: string; payload: Record<string, string> }[] = [];

mock.module("web-push", () => ({
  default: {
    setVapidDetails: () => {},
    sendNotification: async (sub: { endpoint: string }, body: string) => {
      pushSends.push({ endpoint: sub.endpoint, payload: JSON.parse(body) });
    },
  },
}));

describe("nudge cron", () => {
  let memory: MemoryDb;
  let processDueNudges: (now?: Date) => Promise<{ due: number; sent: number; skipped: number }>;
  /** 10:00 local on a day in the account's timezone. */
  const now = new Date(zonedLocalToUtcMs("2026-10-11", "10:00", TZ));

  beforeAll(async () => {
    process.env.VAPID_PUBLIC_KEY = "test-public-key";
    process.env.VAPID_PRIVATE_KEY = "test-private-key";
    memory = installMemoryDb();
    /* Imported after the mock so the stubbed sender is the one wired in. */
    ({ processDueNudges } = await import("@/api/lib/nudges"));
  });

  afterAll(() => {
    uninstallMemoryDb();
  });

  beforeEach(async () => {
    memory._reset();
    pushSends.length = 0;
    process.env.VAPID_PUBLIC_KEY = "test-public-key";

    await memory.collection(COLLECTIONS.users).insertOne({
      _id: new ObjectId(ACCOUNT_ID),
      address: "0xabc",
      codename: "tester",
      timezone: TZ,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  /** Register a push device for the test account. */
  async function addDevice(endpoint = "https://push.example/abc") {
    await memory.collection(COLLECTIONS.pushSubscriptions).insertOne({
      _id: new ObjectId(),
      accountId: ACCOUNT_ID,
      endpoint,
      keys: { p256dh: "p", auth: "a" },
      createdAt: new Date(),
      lastSeenAt: new Date(),
    });
  }

  /** Insert a nudge that is due at `nextAt` (default: right now). */
  async function addNudge(partial: Record<string, unknown> = {}) {
    const _id = new ObjectId();
    await memory.collection(COLLECTIONS.nudges).insertOne({
      _id,
      accountId: ACCOUNT_ID,
      enc: 1,
      payload: "cipher",
      enabled: true,
      everyMin: 30,
      windowStart: "08:00",
      windowEnd: "22:00",
      notifyDetails: { title: "Drink water", body: "8 glasses today" },
      nextAt: new Date(now),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...partial,
    });

    return _id;
  }

  const nextAtOf = async (_id: ObjectId) =>
    (await memory.collection(COLLECTIONS.nudges).findOne({ _id }))!.nextAt as Date | null;

  test("a due nudge is sent once with its readable copy, then moves to the next slot", async () => {
    await addDevice();
    const id = await addNudge();

    expect(await processDueNudges(now)).toEqual({ due: 1, sent: 1, skipped: 0 });
    expect(pushSends).toHaveLength(1);
    expect(pushSends[0]!.payload).toEqual({
      title: "Drink water",
      body: "8 glasses today",
      tag: `nudge|${id.toHexString()}`,
      url: "/#nudge",
    });
    expect((await nextAtOf(id))!.getTime()).toBe(now.getTime() + 30 * MIN);

    expect(await processDueNudges(now)).toEqual({ due: 0, sent: 0, skipped: 0 });
    expect(pushSends).toHaveLength(1);
  });

  test("two cron passes at once still send a slot only once", async () => {
    await addDevice();
    await addNudge();

    const results = await Promise.all([processDueNudges(now), processDueNudges(now)]);

    expect(results.reduce((sum, r) => sum + r.sent, 0)).toBe(1);
    expect(pushSends).toHaveLength(1);
  });

  test("a nudge whose slot has not come is left alone", async () => {
    await addDevice();
    const later = new Date(now.getTime() + 10 * MIN);
    const id = await addNudge({ nextAt: later });

    expect(await processDueNudges(now)).toEqual({ due: 0, sent: 0, skipped: 0 });
    expect((await nextAtOf(id))!.getTime()).toBe(later.getTime());
  });

  test("a goal met today keeps it quiet and still advances; yesterday's does not", async () => {
    await addDevice();
    const met = await addNudge({ metOn: "2026-10-11" });
    const yesterday = await addNudge({ metOn: "2026-10-10" });

    const result = await processDueNudges(now);

    expect(result).toEqual({ due: 2, sent: 1, skipped: 1 });
    expect((await nextAtOf(met))!.getTime()).toBe(now.getTime() + 30 * MIN);
    expect((await nextAtOf(yesterday))!.getTime()).toBe(now.getTime() + 30 * MIN);
  });

  test("a slot reached more than 30 minutes late is skipped, not sent stale", async () => {
    await addDevice();
    const stale = await addNudge({ nextAt: new Date(now.getTime() - 31 * MIN) });
    const fresh = await addNudge({ nextAt: new Date(now.getTime() - 29 * MIN) });

    expect(await processDueNudges(now)).toEqual({ due: 2, sent: 1, skipped: 1 });
    expect((await nextAtOf(stale))!.getTime()).toBe(now.getTime() + 30 * MIN);
    expect((await nextAtOf(fresh))!.getTime()).toBe(now.getTime() + 30 * MIN);
  });

  test("a nudge without a readable copy is advanced without sending", async () => {
    await addDevice();
    const id = await addNudge({ notifyDetails: undefined });

    expect(await processDueNudges(now)).toEqual({ due: 1, sent: 0, skipped: 1 });
    expect((await nextAtOf(id))!.getTime()).toBe(now.getTime() + 30 * MIN);
  });

  test("an account with no push device just advances", async () => {
    const id = await addNudge();

    expect(await processDueNudges(now)).toEqual({ due: 1, sent: 0, skipped: 1 });
    expect(pushSends).toHaveLength(0);
    expect((await nextAtOf(id))!.getTime()).toBe(now.getTime() + 30 * MIN);
  });

  test("the next slot after the window closes is tomorrow's opening", async () => {
    await addDevice();
    const lastSlot = new Date(zonedLocalToUtcMs("2026-10-11", "22:00", TZ));
    const id = await addNudge({ nextAt: lastSlot });

    await processDueNudges(lastSlot);

    expect((await nextAtOf(id))!.getTime()).toBe(zonedLocalToUtcMs("2026-10-12", "08:00", TZ));
  });

  test("nothing happens while push is not configured", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    const id = await addNudge();

    expect(await processDueNudges(now)).toEqual({ due: 0, sent: 0, skipped: 0 });
    expect((await nextAtOf(id))!.getTime()).toBe(now.getTime());
  });
});

describe("nudge account purge", () => {
  test("nudges are deleted with the account", () => {
    expect(OWNED_BY_ACCOUNT_ID).toContain(COLLECTIONS.nudges);
  });
});
