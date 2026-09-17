import { createApiApp } from "@/api/app";
import { describe, expect, test } from "bun:test";
import { patchProfile as patchProfileRaw, signIn } from "../helpers/api-client";
import { useMemoryDb } from "../helpers/memory-db";

const app = createApiApp();

type ProfileBody = {
  profile: { currentMonth: string; tourPreference: string; toursSeen: string[] };
};

const patchProfile = (cookie: string, body: unknown) =>
  patchProfileRaw<ProfileBody>(app, cookie, body);

describe("profile carries guided-tour onboarding state", () => {
  useMemoryDb();

  test("a fresh profile reads as never asked", async () => {
    const cookie = await signIn(app);

    const res = await app.request("/api/profile", { headers: { cookie } });
    const { profile } = (await res.json()) as ProfileBody;

    expect(profile.tourPreference).toBe("pending");
    expect(profile.toursSeen).toEqual([]);
  });

  test("PATCH persists the choice and the seen list", async () => {
    const cookie = await signIn(app);

    const saved = await patchProfile(cookie, {
      tourPreference: "explore",
      toursSeen: ["shell", "overview"],
    });
    expect(saved.status).toBe(200);
    expect(saved.json.profile.tourPreference).toBe("explore");
    expect(saved.json.profile.toursSeen).toEqual(["shell", "overview"]);

    /* Survives a reload — this is the whole point of moving it off localStorage. */
    const reread = await app.request("/api/profile", { headers: { cookie } });
    const { profile } = (await reread.json()) as ProfileBody;

    expect(profile.tourPreference).toBe("explore");
    expect(profile.toursSeen).toEqual(["shell", "overview"]);
  });

  test("a month change leaves onboarding state alone", async () => {
    const cookie = await signIn(app);
    await patchProfile(cookie, { tourPreference: "guided", toursSeen: ["shell"] });

    const { json } = await patchProfile(cookie, { currentMonth: "2026-07" });

    expect(json.profile.currentMonth).toBe("2026-07");
    expect(json.profile.tourPreference).toBe("guided");
    expect(json.profile.toursSeen).toEqual(["shell"]);
  });

  test("an unknown preference is rejected", async () => {
    const cookie = await signIn(app);

    const { status } = await patchProfile(cookie, { tourPreference: "whatever" });

    expect(status).toBe(400);
  });
});
