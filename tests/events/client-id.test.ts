import { createApiApp } from "@/api/app";
import { SESSION_COOKIE } from "@/api/lib/auth";
import { resetRateLimitsForTests } from "@/api/middleware/rate-limit";
import { Wallet } from "ethers";
import { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { installMemoryDb, uninstallMemoryDb, type MemoryDb } from "../helpers/memory-db";

const app = createApiApp();

async function signIn(): Promise<string> {
  const wallet = Wallet.createRandom();
  const challengeRes = await app.request("/api/auth/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: wallet.address }),
  });
  const challenge = (await challengeRes.json()) as { message: string };
  const signature = await wallet.signMessage(challenge.message);
  const verifyRes = await app.request("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: wallet.address, message: challenge.message, signature }),
  });
  const setCookie = verifyRes.headers.get("set-cookie") || "";
  const match = setCookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return `${SESSION_COOKIE}=${match![1]!}`;
}

describe("POST /events with a client-supplied id (offline write queue)", () => {
  let memoryDb: MemoryDb;
  let cookie = "";

  beforeAll(() => {
    memoryDb = installMemoryDb();
  });

  afterAll(() => {
    uninstallMemoryDb();
  });

  beforeEach(async () => {
    resetRateLimitsForTests();
    memoryDb._reset();
    cookie = await signIn();
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
