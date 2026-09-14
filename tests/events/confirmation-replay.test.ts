import { createApiApp } from "@/api/app";
import { SESSION_COOKIE } from "@/api/lib/auth";
import { resetRateLimitsForTests } from "@/api/middleware/rate-limit";
import { Wallet } from "ethers";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { installEmailMock } from "../helpers/email-mock";
import { installMemoryDb, uninstallMemoryDb, type MemoryDb } from "../helpers/memory-db";

/*
 * Pins the fix for src/api/routes/events.ts's PATCH handler: the "reminder
 * enabled" confirmation email must fire only on the actual off→on
 * transition, not on every patch that happens to carry `notify: true` —
 * previously, editing an already-notifying event (or the offline write
 * queue replaying an identical update) re-sent the confirmation every time.
 */

const emailSends: Array<{ to: string; subject: string }> = [];

installEmailMock({
  emailConfigured: () => true,
  sendEmail: async (input) => {
    emailSends.push({ to: input.to, subject: input.subject });
    return { ok: true, id: "test" };
  },
});

const app = createApiApp();

async function signInWithEmail(notifyEmail: string): Promise<{ cookie: string }> {
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
  const cookie = `${SESSION_COOKIE}=${match![1]!}`;

  await app.request("/api/users/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ notifyEmail }),
  });

  return { cookie };
}

describe("event confirmation email on PATCH", () => {
  let memoryDb: MemoryDb;

  beforeAll(() => {
    process.env.RESEND_API_KEY = "test-resend-key";
    memoryDb = installMemoryDb();
  });

  afterAll(() => {
    uninstallMemoryDb();
  });

  beforeEach(() => {
    resetRateLimitsForTests();
    memoryDb._reset();
    emailSends.length = 0;
  });

  test("re-patching an already-notifying event does not resend the confirmation", async () => {
    const { cookie } = await signInWithEmail("owner@example.com");

    const createRes = await app.request("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        catId: "bill",
        date: "2026-09-01",
        notify: true,
        lead: "1d",
        notifyDetails: { title: "Rent" },
        enc: 1,
        payload: "ciphertext",
      }),
    });
    expect(createRes.status).toBe(201);
    const { event } = (await createRes.json()) as { event: { id: string } };

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(emailSends.length).toBe(1);

    // Edit something else, still carrying notify: true (as saveEventMutation
    // always does — it re-sends the caller's full LedgerEvent every time,
    // and the offline write-queue replays this exact same patch on retry).
    const patchRes = await app.request(`/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        notify: true,
        notifyDetails: { title: "Rent (updated)" },
        enc: 1,
        payload: "ciphertext-2",
      }),
    });
    expect(patchRes.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(emailSends.length).toBe(1);

    // A second identical replay (the offline outbox retrying the same body).
    const replayRes = await app.request(`/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        notify: true,
        notifyDetails: { title: "Rent (updated)" },
        enc: 1,
        payload: "ciphertext-2",
      }),
    });
    expect(replayRes.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(emailSends.length).toBe(1);
  });

  test("turning notify on via PATCH still sends the confirmation", async () => {
    const { cookie } = await signInWithEmail("owner@example.com");

    const createRes = await app.request("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        catId: "bill",
        date: "2026-09-01",
        notify: false,
        enc: 1,
        payload: "ciphertext",
      }),
    });
    expect(createRes.status).toBe(201);
    const { event } = (await createRes.json()) as { event: { id: string } };

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(emailSends.length).toBe(0);

    const patchRes = await app.request(`/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        notify: true,
        lead: "1d",
        notifyDetails: { title: "Rent" },
        enc: 1,
        payload: "ciphertext-2",
      }),
    });
    expect(patchRes.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(emailSends.length).toBe(1);
    expect(emailSends[0]!.to).toBe("owner@example.com");
  });
});
