import { createApiApp } from "@/api/app";
import { beforeEach, describe, expect, test } from "bun:test";
import { signIn } from "../helpers/api-client";
import { useMemoryDb } from "../helpers/memory-db";

const app = createApiApp();

/**
 * A queued offline DELETE that lands twice (the client never saw the first
 * response before losing connection again) must not be treated as an error
 * on replay — the offline write queue's drain loop relies on this exact
 * "404 on a repeat DELETE means it already succeeded" contract.
 */
describe("DELETE /expenses/:id replay", () => {
  useMemoryDb();
  let cookie = "";

  beforeEach(async () => {
    cookie = await signIn(app);
  });

  test("a second delete on an already-deleted expense returns 404, not an error", async () => {
    const walletRes = await app.request("/api/wallets", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ currency: "MYR", enc: 1, payload: "wallet" }),
    });
    const { wallet } = (await walletRes.json()) as { wallet: { id: string } };

    const createRes = await app.request("/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ walletId: wallet.id, date: "2026-08-01", enc: 1, payload: "expense" }),
    });
    const { expense } = (await createRes.json()) as { expense: { id: string } };

    const first = await app.request(`/api/expenses/${expense.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(first.status).toBe(200);

    const replay = await app.request(`/api/expenses/${expense.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(replay.status).toBe(404);
  });
});
