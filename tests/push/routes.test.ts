import { createApiApp } from "@/api/app";
import { describe, expect, test } from "bun:test";
import { signIn } from "../helpers/api-client";
import { useMemoryDb } from "../helpers/memory-db";

const app = createApiApp();

const VALID_ENDPOINT = "https://fcm.googleapis.com/fcm/send/device-token-abc";
const VALID_KEYS = { p256dh: "a".repeat(80), auth: "b".repeat(20) };

describe("push routes", () => {
  useMemoryDb();

  test("rejects non-HTTPS push endpoints", async () => {
    const cookie = await signIn(app);
    const res = await app.request("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        endpoint: "http://169.254.169.254/latest/meta-data/",
        keys: VALID_KEYS,
      }),
    });

    expect(res.status).toBe(400);
  });

  test("rejects endpoints from unknown hosts", async () => {
    const cookie = await signIn(app);
    const res = await app.request("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        endpoint: "https://evil.example.com/push",
        keys: VALID_KEYS,
      }),
    });

    expect(res.status).toBe(400);
  });

  test("blocks cross-account endpoint hijack", async () => {
    const cookieA = await signIn(app);
    const cookieB = await signIn(app);

    const ok = await app.request("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: cookieA },
      body: JSON.stringify({ endpoint: VALID_ENDPOINT, keys: VALID_KEYS }),
    });
    expect(ok.status).toBe(200);

    const hijack = await app.request("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: cookieB },
      body: JSON.stringify({ endpoint: VALID_ENDPOINT, keys: VALID_KEYS }),
    });
    expect(hijack.status).toBe(409);
  });

  test("allows the same account to refresh its subscription", async () => {
    const cookie = await signIn(app);

    const first = await app.request("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ endpoint: VALID_ENDPOINT, keys: VALID_KEYS }),
    });
    expect(first.status).toBe(200);

    const second = await app.request("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        endpoint: VALID_ENDPOINT,
        keys: { p256dh: "c".repeat(80), auth: "d".repeat(20) },
      }),
    });
    expect(second.status).toBe(200);
  });
});
