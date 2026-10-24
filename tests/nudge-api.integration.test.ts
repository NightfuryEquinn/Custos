import { expect, mock, test } from "bun:test";
import { MongoClient, ObjectId } from "mongodb";
import { getCollections, COLLECTIONS } from "../src/db/collections";
import type { MiddlewareHandler } from "hono";
import type { SessionVariables } from "../src/api/middleware/session";

// Explicit opt-in only: never fall back to the application's MONGODB_URI.
const uri = process.env.CUSTOS_TEST_MONGO_URI;
test.skipIf(!uri)(
  "Nudge transaction, replay, ownership, pagination and cascade contracts",
  async () => {
    const client = new MongoClient(uri!);
    await client.connect();
    const db = client.db(`custos_test_661_${new ObjectId().toHexString()}`);
    const accountId = new ObjectId().toHexString();
    const otherId = new ObjectId().toHexString();
    const auth: MiddlewareHandler<{ Variables: SessionVariables }> = async (c, next) => {
      c.set("accountId", c.req.header("x-test-account") ?? accountId);
      await next();
    };
    mock.module("../src/db", () => ({
      getDb: () => db,
      getMongoClient: () => client,
      getCollections,
      COLLECTIONS,
    }));
    mock.module("../src/api/middleware/session", () => ({ sessionAuth: auth }));
    const { nudgesRoutes } = await import("../src/api/routes/nudges");
    const request = (path: string, method = "GET", body?: unknown, owner = accountId) =>
      nudgesRoutes.request(path, {
        method,
        headers: { "Content-Type": "application/json", "x-test-account": owner },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const definition = {
      enc: 1,
      payload: "initial-ciphertext",
      enabled: false,
      everyMin: 60,
      windowStart: "08:00",
      windowEnd: "22:00",
      notifyDetails: null,
      metOn: null,
    };
    try {
      const created = await request("/", "POST", definition);
      expect(created.status).toBe(201);
      const { nudge } = (await created.json()) as { nudge: { id: string } };
      const id = nudge.id;
      const event = {
        id: new ObjectId().toHexString(),
        day: "2026-10-24",
        at: "2026-10-24T03:00:00.000Z",
        enc: 1,
        payload: "event-ciphertext",
        nudge: { ...definition, payload: "updated-ciphertext" },
        expectedRevision: 0,
      };
      expect((await request(`/${id}/check-ins`, "POST", event)).status).toBe(201);
      expect((await request(`/${id}/check-ins`, "POST", event)).status).toBe(201);
      expect(await db.collection(COLLECTIONS.nudgeCheckIns).countDocuments()).toBe(1);
      expect(
        (await db.collection(COLLECTIONS.nudges).findOne({ _id: new ObjectId(id) }))?.revision,
      ).toBe(1);
      // A stale second write must change neither collection.
      expect(
        (await request(`/${id}/check-ins`, "POST", { ...event, id: new ObjectId().toHexString() }))
          .status,
      ).toBe(409);
      expect(await db.collection(COLLECTIONS.nudgeCheckIns).countDocuments()).toBe(1);
      expect((await request(`/${id}/check-ins`, "POST", event, otherId)).status).toBe(404);
      expect((await request(`/${id}/check-ins`, "GET", undefined, otherId)).status).toBe(404);
      // Force the second transactional write to fail; the parent update must roll back.
      await db.command({
        collMod: COLLECTIONS.nudgeCheckIns,
        validator: { payload: { $ne: "reject-this-write" } },
        validationLevel: "strict",
        validationAction: "error",
      });
      const failed = await request(`/${id}/check-ins`, "POST", {
        ...event,
        id: new ObjectId().toHexString(),
        payload: "reject-this-write",
        expectedRevision: 1,
      });
      expect(failed.status).toBe(500);
      expect(
        (await db.collection(COLLECTIONS.nudges).findOne({ _id: new ObjectId(id) }))?.revision,
      ).toBe(1);
      await db.command({ collMod: COLLECTIONS.nudgeCheckIns, validator: {} });
      // More than one page, including equal timestamps, must have no duplicate or missing IDs.
      const fixtures = Array.from({ length: 55 }, () => ({
        _id: new ObjectId(),
        accountId,
        nudgeId: id,
        day: event.day,
        at: event.at,
        enc: 1,
        payload: "history",
      }));
      await db.collection(COLLECTIONS.nudgeCheckIns).insertMany(fixtures);
      const first = (await (await request(`/${id}/check-ins?day=${event.day}`)).json()) as {
        events: { id: string }[];
        cursor: string;
      };
      const second = (await (
        await request(
          `/${id}/check-ins?day=${event.day}&cursor=${encodeURIComponent(first.cursor)}`,
        )
      ).json()) as { events: { id: string }[]; cursor: string | null };
      expect(first.events).toHaveLength(50);
      expect(second.events).toHaveLength(6);
      expect(new Set([...first.events, ...second.events].map((row) => row.id)).size).toBe(56);
      expect(second.cursor).toBeNull();
      const restored = { ...event, id: new ObjectId().toHexString() };
      expect((await request(`/${id}/check-ins/${restored.id}`, "PUT", restored)).status).toBe(200);
      expect((await request(`/${id}/check-ins/${restored.id}`, "PUT", restored)).status).toBe(200);
      expect(await db.collection(COLLECTIONS.nudgeCheckIns).countDocuments()).toBe(57);
      expect(
        (await db.collection(COLLECTIONS.nudges).findOne({ _id: new ObjectId(id) }))?.payload,
      ).toBe("updated-ciphertext");
      expect((await request(`/${id}`, "DELETE")).status).toBe(200);
      expect(await db.collection(COLLECTIONS.nudgeCheckIns).countDocuments()).toBe(0);
    } finally {
      // This name was minted above solely for this test run.
      await db.dropDatabase();
      await client.close();
      mock.restore();
    }
  },
  30_000,
);
