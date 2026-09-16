import { createApiApp } from "@/api/app";
import { SESSION_COOKIE } from "@/api/lib/auth";
import { resetRateLimitsForTests } from "@/api/middleware/rate-limit";
import { Wallet } from "ethers";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { installMemoryDb, uninstallMemoryDb, type MemoryDb } from "../helpers/memory-db";

const app = createApiApp();

type ProfileBody = {
  profile: { currentMonth: string; navTabs?: string[]; navOrder?: string[] };
};

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

/** PATCH the profile with an arbitrary body and return status + parsed JSON. */
async function patchProfile(cookie: string, body: unknown) {
  const res = await app.request("/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  });

  return { status: res.status, json: (await res.json()) as ProfileBody };
}

describe("profile carries custom nav layout", () => {
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

  test("a fresh profile has no nav fields set", async () => {
    const cookie = await signIn();

    const res = await app.request("/api/profile", { headers: { cookie } });
    const { profile } = (await res.json()) as ProfileBody;

    expect(profile.navTabs).toBeUndefined();
    expect(profile.navOrder).toBeUndefined();
  });

  test("PATCH persists both fields and survives a re-read", async () => {
    const cookie = await signIn();

    const navTabs = ["budgets", "piggies", "insights", "overview"];
    const navOrder = ["piggies", "budgets", "overview", "insights", "transactions"];
    const saved = await patchProfile(cookie, { navTabs, navOrder });
    expect(saved.status).toBe(200);
    expect(saved.json.profile.navTabs).toEqual(navTabs);
    expect(saved.json.profile.navOrder).toEqual(navOrder);

    const reread = await app.request("/api/profile", { headers: { cookie } });
    const { profile } = (await reread.json()) as ProfileBody;

    expect(profile.navTabs).toEqual(navTabs);
    expect(profile.navOrder).toEqual(navOrder);
  });

  test("a currentMonth PATCH leaves nav prefs alone", async () => {
    const cookie = await signIn();
    const navTabs = ["budgets", "piggies", "insights", "overview"];
    await patchProfile(cookie, { navTabs, navOrder: navTabs });

    const { json } = await patchProfile(cookie, { currentMonth: "2026-07" });

    expect(json.profile.currentMonth).toBe("2026-07");
    expect(json.profile.navTabs).toEqual(navTabs);
    expect(json.profile.navOrder).toEqual(navTabs);
  });

  test("fewer than four tabs is rejected", async () => {
    const cookie = await signIn();

    const { status } = await patchProfile(cookie, {
      navTabs: ["overview", "schedule", "transactions"],
    });

    expect(status).toBe(400);
  });

  test("a duplicate id in navTabs is rejected", async () => {
    const cookie = await signIn();

    const { status } = await patchProfile(cookie, {
      navTabs: ["overview", "overview", "schedule", "transactions"],
    });

    expect(status).toBe(400);
  });

  test("an unknown view id is rejected", async () => {
    const cookie = await signIn();

    const { status } = await patchProfile(cookie, {
      navTabs: ["overview", "schedule", "transactions", "nonexistent"],
    });

    expect(status).toBe(400);
  });

  test("a duplicate id in navOrder is rejected", async () => {
    const cookie = await signIn();

    const { status } = await patchProfile(cookie, {
      navOrder: ["overview", "overview"],
    });

    expect(status).toBe(400);
  });
});
