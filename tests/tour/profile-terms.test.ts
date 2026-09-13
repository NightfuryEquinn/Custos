import { createApiApp } from "@/api/app";
import { SESSION_COOKIE } from "@/api/lib/auth";
import { resetRateLimitsForTests } from "@/api/middleware/rate-limit";
import { TERMS_VERSION } from "@/lib/legal";
import { Wallet } from "ethers";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { installMemoryDb, uninstallMemoryDb, type MemoryDb } from "../helpers/memory-db";

const app = createApiApp();

type ProfileBody = { profile: { termsVersion?: string } };

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

describe("profile records Terms acceptance", () => {
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

  test("a fresh profile has never accepted", async () => {
    const cookie = await signIn();

    const res = await app.request("/api/profile", { headers: { cookie } });
    const { profile } = (await res.json()) as ProfileBody;

    expect(profile.termsVersion).toBeUndefined();
  });

  test("PATCH accepts and persists the current version", async () => {
    const cookie = await signIn();

    const saved = await patchProfile(cookie, { termsVersion: TERMS_VERSION });
    expect(saved.status).toBe(200);
    expect(saved.json.profile.termsVersion).toBe(TERMS_VERSION);

    const reread = await app.request("/api/profile", { headers: { cookie } });
    const { profile } = (await reread.json()) as ProfileBody;
    expect(profile.termsVersion).toBe(TERMS_VERSION);
  });

  test("a client cannot declare acceptance of an arbitrary version", async () => {
    const cookie = await signIn();

    const { status } = await patchProfile(cookie, { termsVersion: "9999-99-99" });

    expect(status).toBe(400);
  });
});
