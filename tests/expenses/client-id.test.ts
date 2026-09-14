import { createApiApp } from "@/api/app";
import { SESSION_COOKIE } from "@/api/lib/auth";
import { resetRateLimitsForTests } from "@/api/middleware/rate-limit";
import { Wallet } from "ethers";
import { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { installMemoryDb, uninstallMemoryDb, type MemoryDb } from "../helpers/memory-db";

const app = createApiApp();

/** Sign in a fresh wallet and return its session cookie. */
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

/** Create a wallet for the signed-in account and return its id. */
async function createWallet(cookie: string): Promise<string> {
  const res = await app.request("/api/wallets", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ currency: "MYR", enc: 1, payload: "wallet" }),
  });
  const { wallet } = (await res.json()) as { wallet: { id: string } };
  return wallet.id;
}

describe("POST /expenses with a client-supplied id (offline write queue)", () => {
  let memoryDb: MemoryDb;
  let cookie = "";
  let walletId = "";

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
    walletId = await createWallet(cookie);
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

    const otherCookie = await signIn();
    const otherWalletId = await createWallet(otherCookie);
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
