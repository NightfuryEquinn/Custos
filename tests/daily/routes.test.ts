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

async function createRoutine(cookie: string, id?: string) {
  const res = await app.request(
    "/api/daily/routines",
    json(cookie, "POST", { ...(id ? { id } : {}), enc: 1, payload: "routine-cipher" }),
  );
  const body = (await res.json()) as { routine: { id: string } };

  return { status: res.status, id: body.routine.id };
}

const putCompletion = (cookie: string, routineId: string, period: string, payload = "done-1") =>
  app.request(
    "/api/daily/completions",
    json(cookie, "PUT", { routineId, period, enc: 1, payload }),
  );

type Completions = {
  completions: { id: string; routineId: string; period: string; payload: string }[];
};
const listCompletions = async (cookie: string) =>
  (
    (await (
      await app.request("/api/daily/completions", { headers: { cookie } })
    ).json()) as Completions
  ).completions;

describe("daily routine routes", () => {
  useMemoryDb();

  test("creating with a client id is idempotent", async () => {
    const cookie = await signIn(app);
    const id = "a".repeat(24);

    const first = await createRoutine(cookie, id);
    const replay = await createRoutine(cookie, id);

    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.id).toBe(id);
  });

  test("an account only lists its own routines", async () => {
    const mine = await signIn(app);
    const theirs = await signIn(app);
    await createRoutine(mine);
    await createRoutine(theirs);

    const res = await app.request("/api/daily/routines", { headers: { cookie: mine } });
    const { routines } = (await res.json()) as { routines: unknown[] };

    expect(routines).toHaveLength(1);
  });

  test("updating replaces the payload, and another account cannot touch it", async () => {
    const owner = await signIn(app);
    const intruder = await signIn(app);
    const { id } = await createRoutine(owner);

    const ok = await app.request(
      `/api/daily/routines/${id}`,
      json(owner, "PATCH", { enc: 1, payload: "renamed" }),
    );
    const denied = await app.request(
      `/api/daily/routines/${id}`,
      json(intruder, "PATCH", { enc: 1, payload: "hijack" }),
    );
    const malformed = await app.request(
      "/api/daily/routines/not-an-id",
      json(owner, "PATCH", { enc: 1, payload: "x" }),
    );

    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { routine: { payload: string } }).routine.payload).toBe("renamed");
    expect(denied.status).toBe(404);
    expect(malformed.status).toBe(404);
  });
});

describe("daily completion routes", () => {
  useMemoryDb();

  test("setting the same period twice keeps one row holding the latest state", async () => {
    const cookie = await signIn(app);
    const { id } = await createRoutine(cookie);

    expect((await putCompletion(cookie, id, "2026-10-09", "done-1")).status).toBe(200);
    expect((await putCompletion(cookie, id, "2026-10-09", "done-0")).status).toBe(200);
    expect((await putCompletion(cookie, id, "2026-10-09", "done-1")).status).toBe(200);

    const rows = await listCompletions(cookie);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ routineId: id, period: "2026-10-09", payload: "done-1" });
  });

  test("different periods are independent rows", async () => {
    const cookie = await signIn(app);
    const { id } = await createRoutine(cookie);

    await putCompletion(cookie, id, "2026-10-08");
    await putCompletion(cookie, id, "2026-10-09");

    expect((await listCompletions(cookie)).map((r) => r.period).sort()).toEqual([
      "2026-10-08",
      "2026-10-09",
    ]);
  });

  test("completing another account's routine is refused and writes nothing", async () => {
    const owner = await signIn(app);
    const intruder = await signIn(app);
    const { id } = await createRoutine(owner);

    const res = await putCompletion(intruder, id, "2026-10-09");

    expect(res.status).toBe(404);
    expect(await listCompletions(owner)).toHaveLength(0);
    expect(await listCompletions(intruder)).toHaveLength(0);
  });

  test("completing a routine that does not exist is refused", async () => {
    const cookie = await signIn(app);

    expect((await putCompletion(cookie, "b".repeat(24), "2026-10-09")).status).toBe(404);
  });

  test("a malformed routine id or period is rejected", async () => {
    const cookie = await signIn(app);
    const { id } = await createRoutine(cookie);

    expect((await putCompletion(cookie, "nope", "2026-10-09")).status).toBe(400);
    expect((await putCompletion(cookie, id, "10/09/2026")).status).toBe(400);
  });

  test("each account lists only its own completions", async () => {
    const mine = await signIn(app);
    const theirs = await signIn(app);
    const a = await createRoutine(mine);
    const b = await createRoutine(theirs);
    await putCompletion(mine, a.id, "2026-10-09");
    await putCompletion(theirs, b.id, "2026-10-09");

    const rows = await listCompletions(mine);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.routineId).toBe(a.id);
  });
});

describe("daily route hardening", () => {
  useMemoryDb();

  test("the same routine in upper and lower case is one completion row, not two", async () => {
    const cookie = await signIn(app);
    const { id } = await createRoutine(cookie);

    expect((await putCompletion(cookie, id, "2026-10-09")).status).toBe(200);
    expect((await putCompletion(cookie, id.toUpperCase(), "2026-10-09", "done-0")).status).toBe(
      200,
    );

    const rows = await listCompletions(cookie);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.routineId).toBe(id);
  });

  test("an impossible calendar date is rejected as a period", async () => {
    const cookie = await signIn(app);
    const { id } = await createRoutine(cookie);

    expect((await putCompletion(cookie, id, "2026-02-31")).status).toBe(400);
    expect((await putCompletion(cookie, id, "2026-13-01")).status).toBe(400);
    expect((await putCompletion(cookie, id, "2028-02-29")).status).toBe(200); // leap day is real
  });

  test("completion timestamps carry the day only, not the time of the tick", async () => {
    const cookie = await signIn(app);
    const { id } = await createRoutine(cookie);
    await putCompletion(cookie, id, "2026-10-09");

    const res = await app.request("/api/daily/completions", { headers: { cookie } });
    const { completions } = (await res.json()) as {
      completions: { createdAt: string; updatedAt: string }[];
    };

    expect(completions[0]!.createdAt).toEndWith("T00:00:00.000Z");
    expect(completions[0]!.updatedAt).toEndWith("T00:00:00.000Z");
  });

  test("deleting a routine removes its completions and nothing else", async () => {
    const cookie = await signIn(app);
    const other = await signIn(app);
    const gone = await createRoutine(cookie);
    const kept = await createRoutine(cookie);
    await putCompletion(cookie, gone.id, "2026-10-08");
    await putCompletion(cookie, gone.id, "2026-10-09");
    await putCompletion(cookie, kept.id, "2026-10-09");

    expect(
      (await app.request(`/api/daily/routines/${gone.id}`, json(other, "DELETE"))).status,
    ).toBe(404);
    expect((await listCompletions(cookie)).length).toBe(3);

    expect(
      (await app.request(`/api/daily/routines/${gone.id}`, json(cookie, "DELETE"))).status,
    ).toBe(200);
    expect((await listCompletions(cookie)).map((c) => c.routineId)).toEqual([kept.id]);
    expect(
      (await app.request(`/api/daily/routines/${gone.id}`, json(cookie, "DELETE"))).status,
    ).toBe(404);
    expect((await putCompletion(cookie, gone.id, "2026-10-10")).status).toBe(404);
  });

  test("Daily reads are never stored by the browser or a shared cache", async () => {
    const cookie = await signIn(app);
    for (const path of ["/api/daily/routines", "/api/daily/completions"]) {
      const res = await app.request(path, { headers: { cookie } });
      expect(res.headers.get("cache-control")).toContain("no-store");
    }
  });
});
