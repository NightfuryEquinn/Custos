import { createApiApp } from "@/api/app";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, test } from "bun:test";
import { createWallet, signIn } from "../helpers/api-client";
import { useMemoryDb } from "../helpers/memory-db";

const app = createApiApp();

describe("POST /expenses with a client-supplied id (offline write queue)", () => {
  useMemoryDb();
  let cookie = "";
  let walletId = "";

  beforeEach(async () => {
    cookie = await signIn(app);
    walletId = await createWallet(app, cookie, "wallet");
  });

  test("honors a client-supplied id", async () => {
    const id = new ObjectId().toHexString();
    const res = await app.request("/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ id, walletId, date: "2026-08-01", enc: 1, payload: "expense" }),
    });

    expect(res.status).toBe(201);
    const { expense } = (await res.json()) as { expense: { id: string } };
    expect(expense.id).toBe(id);
  });

  test("replaying the identical create returns the existing document, not a duplicate", async () => {
    const id = new ObjectId().toHexString();
    const body = JSON.stringify({ id, walletId, date: "2026-08-01", enc: 1, payload: "expense" });

    const first = await app.request("/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body,
    });
    expect(first.status).toBe(201);

    const replay = await app.request("/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body,
    });
    expect(replay.status).toBe(200);
    const { expense: replayed } = (await replay.json()) as { expense: { id: string } };
    expect(replayed.id).toBe(id);

    const list = await app.request(`/api/expenses?walletId=${walletId}`, { headers: { cookie } });
    const { expenses } = (await list.json()) as { expenses: unknown[] };
    expect(expenses).toHaveLength(1);
  });

  test("a different account's existing id returns a generic conflict, no data leak", async () => {
    const id = new ObjectId().toHexString();
    await app.request("/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ id, walletId, date: "2026-08-01", enc: 1, payload: "expense" }),
    });

    const otherCookie = await signIn(app);
    const otherWalletId = await createWallet(app, otherCookie, "wallet");
    const res = await app.request("/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: otherCookie },
      body: JSON.stringify({
        id,
        walletId: otherWalletId,
        date: "2026-08-01",
        enc: 1,
        payload: "someone-elses-attempt",
      }),
    });

    expect(res.status).toBe(409);
    const payload = (await res.json()) as { error?: string };
    expect(payload.error).not.toContain("expense"); // never echoes the other account's payload/content
  });

  test("omitting id keeps the legacy server-generated behavior", async () => {
    const res = await app.request("/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ walletId, date: "2026-08-01", enc: 1, payload: "expense" }),
    });

    expect(res.status).toBe(201);
    const { expense } = (await res.json()) as { expense: { id: string } };
    expect(expense.id).toMatch(/^[a-f0-9]{24}$/);
  });
});
