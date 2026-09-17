import { createApiApp } from "@/api/app";
import { describe, expect, test } from "bun:test";
import { patchProfile as patchProfileRaw, signIn } from "../helpers/api-client";
import { useMemoryDb } from "../helpers/memory-db";

const app = createApiApp();

type ProfileBody = {
  profile: { currentMonth: string; navTabs?: string[]; navOrder?: string[] };
};

const patchProfile = (cookie: string, body: unknown) =>
  patchProfileRaw<ProfileBody>(app, cookie, body);

describe("profile carries custom nav layout", () => {
  useMemoryDb();

  test("a fresh profile has no nav fields set", async () => {
    const cookie = await signIn(app);

    const res = await app.request("/api/profile", { headers: { cookie } });
    const { profile } = (await res.json()) as ProfileBody;

    expect(profile.navTabs).toBeUndefined();
    expect(profile.navOrder).toBeUndefined();
  });

  test("PATCH persists both fields and survives a re-read", async () => {
    const cookie = await signIn(app);

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
    const cookie = await signIn(app);
    const navTabs = ["budgets", "piggies", "insights", "overview"];
    await patchProfile(cookie, { navTabs, navOrder: navTabs });

    const { json } = await patchProfile(cookie, { currentMonth: "2026-07" });

    expect(json.profile.currentMonth).toBe("2026-07");
    expect(json.profile.navTabs).toEqual(navTabs);
    expect(json.profile.navOrder).toEqual(navTabs);
  });

  test("fewer than four tabs is rejected", async () => {
    const cookie = await signIn(app);

    const { status } = await patchProfile(cookie, {
      navTabs: ["overview", "schedule", "transactions"],
    });

    expect(status).toBe(400);
  });

  test("a duplicate id in navTabs is rejected", async () => {
    const cookie = await signIn(app);

    const { status } = await patchProfile(cookie, {
      navTabs: ["overview", "overview", "schedule", "transactions"],
    });

    expect(status).toBe(400);
  });

  test("an unknown view id is rejected", async () => {
    const cookie = await signIn(app);

    const { status } = await patchProfile(cookie, {
      navTabs: ["overview", "schedule", "transactions", "nonexistent"],
    });

    expect(status).toBe(400);
  });

  test("a duplicate id in navOrder is rejected", async () => {
    const cookie = await signIn(app);

    const { status } = await patchProfile(cookie, {
      navOrder: ["overview", "overview"],
    });

    expect(status).toBe(400);
  });
});
