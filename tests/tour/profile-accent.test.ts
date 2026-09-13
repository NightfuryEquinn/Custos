import { createApiApp } from "@/api/app";
import { SESSION_COOKIE } from "@/api/lib/auth";
import { resetRateLimitsForTests } from "@/api/middleware/rate-limit";
import { Wallet } from "ethers";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { installMemoryDb, uninstallMemoryDb, type MemoryDb } from "../helpers/memory-db";

const app = createApiApp();

type ProfileBody = { profile: { accent?: string } };

/** Sign in a fresh wallet and return its session cookie header value. */
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

async function patchProfile(cookie: string, body: unknown) {
  const res = await app.request("/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  });

  return { status: res.status, json: (await res.json()) as ProfileBody };
}

/*
 * The server does not check supporterSince before accepting an accent write
 * (see the ponytail comment in schemas/profile.ts) — a non-supporter who
 * forges this gets a different shade of brown, nothing more. These tests
 * cover the schema guard, not an entitlement check.
 */
describe("profile records the Supporter accent perk", () => {
  let memory: MemoryDb;

  beforeAll(() => {
    memory = installMemoryDb();
  });

  afterAll(() => {
    uninstallMemoryDb();
  });

  beforeEach(() => {
    memory._reset();
    resetRateLimitsForTests();
  });

  test("a fresh profile has no accent set", async () => {
    const cookie = await signIn();

    const res = await app.request("/api/profile", { headers: { cookie } });
    const { profile } = (await res.json()) as ProfileBody;

    expect(profile.accent).toBeUndefined();
  });

  test("PATCH accepts and persists a known accent name", async () => {
    const cookie = await signIn();

    const saved = await patchProfile(cookie, { accent: "moss" });
    expect(saved.status).toBe(200);
    expect(saved.json.profile.accent).toBe("moss");

    const reread = await app.request("/api/profile", { headers: { cookie } });
    const { profile } = (await reread.json()) as ProfileBody;
    expect(profile.accent).toBe("moss");
  });

  test("an unknown accent name is rejected", async () => {
    const cookie = await signIn();

    const { status } = await patchProfile(cookie, { accent: "chartreuse" });

    expect(status).toBe(400);
  });
});
