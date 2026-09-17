import { createApiApp } from "@/api/app";
import { describe, expect, test } from "bun:test";
import { signIn } from "../helpers/api-client";
import { useMemoryDb } from "../helpers/memory-db";

const app = createApiApp();

describe("profile route exposes createdAt", () => {
  useMemoryDb();

  test("GET /api/profile returns a parseable ISO createdAt", async () => {
    const cookie = await signIn(app);

    const res = await app.request("/api/profile", { headers: { cookie } });
    expect(res.status).toBe(200);

    const { profile } = (await res.json()) as {
      profile: { id: string; currentMonth: string; createdAt: string };
    };

    expect(typeof profile.createdAt).toBe("string");
    expect(Number.isFinite(Date.parse(profile.createdAt))).toBe(true);
    /* The What's New gate compares this against now, so a fresh profile must
       read as newly created rather than as some epoch default. */
    expect(Date.now() - Date.parse(profile.createdAt)).toBeLessThan(60_000);
  });

  test("PATCH /api/profile keeps createdAt on the response", async () => {
    const cookie = await signIn(app);

    const res = await app.request("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ currentMonth: "2026-07" }),
    });
    expect(res.status).toBe(200);

    const { profile } = (await res.json()) as {
      profile: { currentMonth: string; createdAt: string };
    };

    expect(profile.currentMonth).toBe("2026-07");
    expect(Number.isFinite(Date.parse(profile.createdAt))).toBe(true);
  });

  test("profile response still withholds ownership keys", async () => {
    const cookie = await signIn(app);

    const res = await app.request("/api/profile", { headers: { cookie } });
    const { profile } = (await res.json()) as { profile: Record<string, unknown> };

    expect(Object.keys(profile).sort()).toEqual([
      "createdAt",
      "currentMonth",
      "id",
      "tourPreference",
      "toursSeen",
    ]);
  });
});
