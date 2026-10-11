import { createApiApp } from "@/api/app";
import { describe, expect, test } from "bun:test";
import { signIn } from "../helpers/api-client";
import { useMemoryDb } from "../helpers/memory-db";

const app = createApiApp();

const json = (cookie: string, method: string, body?: unknown) => ({
  method,
  headers: { "Content-Type": "application/json", cookie },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

/** A valid nudge body; `over` replaces any field. */
const nudgeBody = (over: Record<string, unknown> = {}) => ({
  enc: 1,
  payload: "nudge-cipher",
  enabled: true,
  everyMin: 30,
  windowStart: "08:00",
  windowEnd: "22:00",
  notifyDetails: { title: "Drink water", body: "8 glasses today" },
  metOn: null,
  ...over,
});

type Saved = {
  id: string;
  enabled: boolean;
  everyMin: number;
  nextAt: string | null;
  notifyDetails?: { title: string; body: string };
  metOn?: string;
  accountId?: string;
};

async function create(cookie: string, over: Record<string, unknown> = {}) {
  const res = await app.request("/api/nudges", json(cookie, "POST", nudgeBody(over)));
  const body = (await res.json()) as { nudge?: Saved };

  return { status: res.status, nudge: body.nudge! };
}

const patch = (cookie: string, id: string, over: Record<string, unknown> = {}) =>
  app.request(`/api/nudges/${id}`, json(cookie, "PATCH", nudgeBody(over)));

describe("nudge routes", () => {
  useMemoryDb();

  test("creating stores the timing in the clear and schedules the next slot", async () => {
    const cookie = await signIn(app);
    const { status, nudge } = await create(cookie);

    expect(status).toBe(201);
    expect(nudge.enabled).toBe(true);
    expect(nudge.everyMin).toBe(30);
    expect(nudge.notifyDetails).toEqual({ title: "Drink water", body: "8 glasses today" });
    expect(Date.parse(nudge.nextAt!)).toBeGreaterThan(Date.now());
    expect(nudge.accountId).toBeUndefined();
  });

  test("creating with a client id is idempotent", async () => {
    const cookie = await signIn(app);
    const id = "b".repeat(24);

    const first = await create(cookie, { id });
    const replay = await create(cookie, { id });

    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.nudge.id).toBe(id);
  });

  test("the interval stays between 30 minutes and 12 hours, in steps of 15", async () => {
    const cookie = await signIn(app);
    const status = async (everyMin: number) => (await create(cookie, { everyMin })).status;

    expect(await status(30)).toBe(201);
    expect(await status(720)).toBe(201);
    expect(await status(45)).toBe(201);
    expect(await status(15)).toBe(400);
    expect(await status(29)).toBe(400);
    expect(await status(31)).toBe(400);
    expect(await status(735)).toBe(400);
    expect(await status(721)).toBe(400);
  });

  test("the window must be real times, ending after it starts", async () => {
    const cookie = await signIn(app);
    const status = async (windowStart: string, windowEnd: string) =>
      (await create(cookie, { windowStart, windowEnd })).status;

    expect(await status("08:00", "22:00")).toBe(201);
    expect(await status("22:00", "08:00")).toBe(400);
    expect(await status("08:00", "08:00")).toBe(400);
    expect(await status("8:00", "22:00")).toBe(400);
    expect(await status("08:00", "24:00")).toBe(400);
  });

  test("a switched-off nudge has no next slot and no readable copy on the server", async () => {
    const cookie = await signIn(app);
    const { nudge } = await create(cookie, { enabled: false });

    expect(nudge.nextAt).toBeNull();
    expect(nudge.notifyDetails).toBeUndefined();
  });

  test("a nudge created switched off stores no goal marker", async () => {
    const cookie = await signIn(app);
    const { nudge } = await create(cookie, { enabled: false, metOn: "2026-10-11" });

    expect(nudge.metOn).toBeUndefined();
  });

  test("turning a nudge off clears its next slot, its copy and its goal marker", async () => {
    const cookie = await signIn(app);
    const { nudge } = await create(cookie, { metOn: "2026-10-11" });
    expect(nudge.metOn).toBe("2026-10-11");

    const res = await patch(cookie, nudge.id, { enabled: false });
    const { nudge: off } = (await res.json()) as { nudge: Saved };

    expect(res.status).toBe(200);
    expect(off.nextAt).toBeNull();
    expect(off.notifyDetails).toBeUndefined();
    expect(off.metOn).toBeUndefined();

    const back = (await (await patch(cookie, nudge.id)).json()) as { nudge: Saved };
    expect(back.nudge.nextAt).not.toBeNull();
    expect(back.nudge.notifyDetails?.title).toBe("Drink water");
  });

  test("an account only lists its own nudges, and cannot change or delete another's", async () => {
    const owner = await signIn(app);
    const intruder = await signIn(app);
    const { nudge } = await create(owner);
    await create(intruder);

    const list = (await (
      await app.request("/api/nudges", { headers: { cookie: owner } })
    ).json()) as {
      nudges: Saved[];
    };
    expect(list.nudges).toHaveLength(1);

    expect((await patch(intruder, nudge.id)).status).toBe(404);
    const del = await app.request(`/api/nudges/${nudge.id}`, json(intruder, "DELETE"));
    expect(del.status).toBe(404);
  });

  test("deleting removes the nudge", async () => {
    const cookie = await signIn(app);
    const { nudge } = await create(cookie);

    const del = await app.request(`/api/nudges/${nudge.id}`, json(cookie, "DELETE"));
    expect(del.status).toBe(200);

    const list = (await (await app.request("/api/nudges", { headers: { cookie } })).json()) as {
      nudges: Saved[];
    };
    expect(list.nudges).toHaveLength(0);
  });

  test("responses are never cached, and a session is required", async () => {
    const cookie = await signIn(app);
    const res = await app.request("/api/nudges", { headers: { cookie } });

    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await app.request("/api/nudges")).status).toBe(401);
  });
});
