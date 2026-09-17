import { createApiApp } from "@/api/app";
import { TERMS_VERSION } from "@/lib/legal";
import { describe, expect, test } from "bun:test";
import { patchProfile as patchProfileRaw, signIn } from "../helpers/api-client";
import { useMemoryDb } from "../helpers/memory-db";

const app = createApiApp();

type ProfileBody = { profile: { termsVersion?: string } };

const patchProfile = (cookie: string, body: unknown) =>
  patchProfileRaw<ProfileBody>(app, cookie, body);

describe("profile records Terms acceptance", () => {
  useMemoryDb();

  test("a fresh profile has never accepted", async () => {
    const cookie = await signIn(app);

    const res = await app.request("/api/profile", { headers: { cookie } });
    const { profile } = (await res.json()) as ProfileBody;

    expect(profile.termsVersion).toBeUndefined();
  });

  test("PATCH accepts and persists the current version", async () => {
    const cookie = await signIn(app);

    const saved = await patchProfile(cookie, { termsVersion: TERMS_VERSION });
    expect(saved.status).toBe(200);
    expect(saved.json.profile.termsVersion).toBe(TERMS_VERSION);

    const reread = await app.request("/api/profile", { headers: { cookie } });
    const { profile } = (await reread.json()) as ProfileBody;
    expect(profile.termsVersion).toBe(TERMS_VERSION);
  });

  test("a client cannot declare acceptance of an arbitrary version", async () => {
    const cookie = await signIn(app);

    const { status } = await patchProfile(cookie, { termsVersion: "9999-99-99" });

    expect(status).toBe(400);
  });
});
