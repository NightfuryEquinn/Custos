import { createApiApp } from "@/api/app";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, test } from "bun:test";
import { signIn } from "../helpers/api-client";
import { useMemoryDb } from "../helpers/memory-db";

const app = createApiApp();

describe("POST /events with a client-supplied id (offline write queue)", () => {
  useMemoryDb();
  let cookie = "";

  beforeEach(async () => {
    cookie = await signIn(app);
  });

  test("honors a client-supplied id and replaying returns the same document", async () => {
    const id = new ObjectId().toHexString();
    const body = JSON.stringify({
      id,
      catId: "bill",
      date: "2026-08-01",
      enc: 1,
      payload: "event",
    });

    const first = await app.request("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body,
    });
    expect(first.status).toBe(201);
    const { event } = (await first.json()) as { event: { id: string } };
    expect(event.id).toBe(id);

    const replay = await app.request("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body,
    });
    expect(replay.status).toBe(200);
    const { event: replayed } = (await replay.json()) as { event: { id: string } };
    expect(replayed.id).toBe(id);

    const list = await app.request("/api/events?month=2026-08", { headers: { cookie } });
    const { events } = (await list.json()) as { events: unknown[] };
    expect(events).toHaveLength(1);
  });
});
