import { createApiApp } from "@/api/app";
import { describe, expect, test } from "bun:test";
import { patchProfile as patchProfileRaw, signIn } from "../helpers/api-client";
import { useMemoryDb } from "../helpers/memory-db";

const app = createApiApp();

type ProfileBody = { profile: { accent?: string } };

const patchProfile = (cookie: string, body: unknown) =>
  patchProfileRaw<ProfileBody>(app, cookie, body);

/*
 * Accent color is free for every account — no entitlement to check. These
 * tests cover the schema guard (known accent names only), not a perk gate.
 */
describe("profile records the accent color pick", () => {
  useMemoryDb();

  test("a fresh profile has no accent set", async () => {
    const cookie = await signIn(app);

    const res = await app.request("/api/profile", { headers: { cookie } });
    const { profile } = (await res.json()) as ProfileBody;

    expect(profile.accent).toBeUndefined();
  });

  test("PATCH accepts and persists a known accent name", async () => {
    const cookie = await signIn(app);

    const saved = await patchProfile(cookie, { accent: "moss" });
    expect(saved.status).toBe(200);
    expect(saved.json.profile.accent).toBe("moss");

    const reread = await app.request("/api/profile", { headers: { cookie } });
    const { profile } = (await reread.json()) as ProfileBody;
    expect(profile.accent).toBe("moss");
  });

  test("an unknown accent name is rejected", async () => {
    const cookie = await signIn(app);

    const { status } = await patchProfile(cookie, { accent: "chartreuse" });

    expect(status).toBe(400);
  });
});
