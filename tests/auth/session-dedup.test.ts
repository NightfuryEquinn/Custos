import { createApiApp } from "@/api/app";
import { SESSION_COOKIE } from "@/api/lib/auth";
import { resetRateLimitsForTests } from "@/api/middleware/rate-limit";
import { Wallet, type HDNodeWallet } from "ethers";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { installMemoryDb, uninstallMemoryDb, type MemoryDb } from "../helpers/memory-db";

const app = createApiApp();

type SessionsBody = {
  sessions: Array<{ id: string; device: string; current: boolean }>;
};

/** Sign in with an explicit User-Agent so device dedup can be tested. */
async function signIn(wallet: HDNodeWallet, userAgent: string): Promise<string> {
  const challengeRes = await app.request("/api/auth/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: wallet.address }),
  });
  const challenge = (await challengeRes.json()) as { message: string };
  const signature = await wallet.signMessage(challenge.message);

  const verifyRes = await app.request("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json", "user-agent": userAgent },
    body: JSON.stringify({ address: wallet.address, message: challenge.message, signature }),
  });
  const setCookie = verifyRes.headers.get("set-cookie") || "";
  const match = setCookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));

  return `${SESSION_COOKIE}=${match![1]!}`;
}

async function listSessions(cookie: string) {
  const res = await app.request("/api/auth/sessions", { headers: { cookie } });
  return (await res.json()) as SessionsBody;
}

describe("repeated sign-in on the same device does not duplicate Active Sessions", () => {
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

  test("signing in twice with the same User-Agent replaces the prior session, not adds to it", async () => {
    const wallet = Wallet.createRandom();
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) TestBrowser/1.0";

    await signIn(wallet, ua); // e.g. cookie lost/cleared client-side, user signs back in
    const cookieB = await signIn(wallet, ua);

    const { sessions } = await listSessions(cookieB);

    expect(sessions.length).toBe(1);
    expect(sessions[0]!.current).toBe(true);
  });

  test("signing in from a different device (different User-Agent) keeps both sessions", async () => {
    const wallet = Wallet.createRandom();
    const uaDesktop = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) TestBrowser/1.0";
    const uaMobile = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) TestBrowser/1.0";

    await signIn(wallet, uaDesktop);
    const cookieMobile = await signIn(wallet, uaMobile);

    const { sessions } = await listSessions(cookieMobile);

    expect(sessions.length).toBe(2);
  });

  test("three logins from the same device settle at one active session, not three", async () => {
    const wallet = Wallet.createRandom();
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) TestBrowser/1.0";

    await signIn(wallet, ua);
    await signIn(wallet, ua);
    const cookieC = await signIn(wallet, ua);

    const { sessions } = await listSessions(cookieC);

    expect(sessions.length).toBe(1);
  });
});
