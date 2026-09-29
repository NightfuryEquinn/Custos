import { describe, expect, test } from "bun:test";
import { createApiApp } from "@/api/app";
import { getCollections, getDb } from "@/db";
import { signIn } from "../helpers/api-client";
import { useMemoryDb } from "../helpers/memory-db";

const app = createApiApp();

async function getMe(cookie: string) {
  const res = await app.request("/api/users/me", { headers: { cookie } });
  expect(res.status).toBe(200);

  return (await res.json()) as { user: { supporterSince?: string } };
}

function patchMe(cookie: string, body: unknown) {
  return app.request("/api/users/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

describe("supporterSince", () => {
  useMemoryDb();

  test("a client cannot set it through PATCH /users/me", async () => {
    const cookie = await signIn(app);
    const res = await patchMe(cookie, {
      supporterSince: "2020-01-01T00:00:00.000Z",
      notifyEmail: "me@example.com",
    });

    expect(res.status).toBe(200);
    expect((await getMe(cookie)).user.supporterSince).toBeUndefined();
  });

  test("a body carrying only supporterSince is rejected as empty", async () => {
    const cookie = await signIn(app);
    const res = await patchMe(cookie, { supporterSince: "2020-01-01T00:00:00.000Z" });

    expect(res.status).toBe(400);
  });

  test("GET /users/me returns it as an ISO string once the grant script has set it", async () => {
    const cookie = await signIn(app);
    const since = new Date("2026-09-01T00:00:00.000Z");
    await getCollections(getDb()).users.updateMany({}, { $set: { supporterSince: since } });

    expect((await getMe(cookie)).user.supporterSince).toBe(since.toISOString());
  });
});
