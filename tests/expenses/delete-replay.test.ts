import { createApiApp } from "@/api/app";
import { SESSION_COOKIE } from "@/api/lib/auth";
import { resetRateLimitsForTests } from "@/api/middleware/rate-limit";
import { Wallet } from "ethers";
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

/**
 * A queued offline DELETE that lands twice (the client never saw the first
 * response before losing connection again) must not be treated as an error
 * on replay — the offline write queue's drain loop relies on this exact
 * "404 on a repeat DELETE means it already succeeded" contract.
 */
describe("DELETE /expenses/:id replay", () => {
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
