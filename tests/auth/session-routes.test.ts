import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createApiApp } from "@/api/app";
import { SESSION_COOKIE, SESSION_MAX_LIFETIME_MS, hashToken } from "@/api/lib/auth";
import { resetRateLimitsForTests } from "@/api/middleware/rate-limit";
import { getCollections } from "@/db";
import { Wallet, type HDNodeWallet } from "ethers";
import { ObjectId, type Db } from "mongodb";
import { installMemoryDb, uninstallMemoryDb, type MemoryDb } from "../helpers/memory-db";

const app = createApiApp();

async function challengeAndVerify(wallet: HDNodeWallet) {
  const challengeRes = await app.request("/api/auth/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: wallet.address }),
  });
  expect(challengeRes.status).toBe(200);
  const challenge = (await challengeRes.json()) as { message: string; nonce: string };
  const signature = await wallet.signMessage(challenge.message);

  const verifyRes = await app.request("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      address: wallet.address,
      message: challenge.message,
      signature,
    }),
  });
  expect(verifyRes.status).toBe(200);
  const setCookie = verifyRes.headers.get("set-cookie") || "";
  const match = setCookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  expect(match).toBeTruthy();
  const body = (await verifyRes.json()) as {
    account: { address: string };
    session: { id: string };
  };
  return { token: match![1]!, body, setCookie };
}

describe("auth session routes", () => {
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

  test("challenge returns a message and stores a nonce", async () => {
    const wallet = Wallet.createRandom();
    const res = await app.request("/api/auth/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: wallet.address }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { message: string; nonce: string; expiresAt: string };
    expect(body.message).toContain("Custos wants you to sign in");
    expect(body.nonce).toBeTruthy();

    const { authNonces } = getCollections(memory as unknown as Db);
    const stored = await authNonces.findOne({ nonce: body.nonce });
    expect(stored).toBeTruthy();
    expect(stored!.usedAt).toBeUndefined();
  });

  test("verify creates a hashed session cookie and upserts the user", async () => {
    const wallet = Wallet.createRandom();
    const { token, body } = await challengeAndVerify(wallet);
    expect(body.account.address).toBe(wallet.address.toLowerCase());

    const { sessions, users } = getCollections(memory as unknown as Db);
    const session = await sessions.findOne({ tokenHash: hashToken(token) });
    expect(session).toBeTruthy();
    expect(session!.tokenHash).not.toBe(token);
    expect(session!.revokedAt).toBeUndefined();

    const user = await users.findOne({ address: wallet.address.toLowerCase() });
    expect(user).toBeTruthy();
  });

  test("nonce cannot be reused", async () => {
    const wallet = Wallet.createRandom();
    const challengeRes = await app.request("/api/auth/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: wallet.address }),
    });
    const challenge = (await challengeRes.json()) as { message: string };
    const signature = await wallet.signMessage(challenge.message);
    const payload = {
      address: wallet.address,
      message: challenge.message,
      signature,
    };

    const first = await app.request("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(200);

    const second = await app.request("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(second.status).toBe(400);
  });

  test("invalid signature is rejected", async () => {
    const wallet = Wallet.createRandom();
    const other = Wallet.createRandom();
    const challengeRes = await app.request("/api/auth/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: wallet.address }),
    });
    const challenge = (await challengeRes.json()) as { message: string };
    const signature = await other.signMessage(challenge.message);

    const res = await app.request("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: wallet.address,
        message: challenge.message,
        signature,
      }),
    });
    expect(res.status).toBe(400);
  });

  test("/auth/me requires a valid session cookie", async () => {
    const missing = await app.request("/api/auth/me");
    expect(missing.status).toBe(401);

    const wallet = Wallet.createRandom();
    const { token } = await challengeAndVerify(wallet);
    const ok = await app.request("/api/auth/me", {
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { account: { address: string } };
    expect(body.account.address).toBe(wallet.address.toLowerCase());
  });

  test("logout revokes the session and clears the cookie", async () => {
    const wallet = Wallet.createRandom();
    const { token } = await challengeAndVerify(wallet);

    const logout = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(logout.status).toBe(200);

    const { sessions } = getCollections(memory as unknown as Db);
    const session = await sessions.findOne({ tokenHash: hashToken(token) });
    expect(session!.revokedAt).toBeTruthy();

    const me = await app.request("/api/auth/me", {
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(me.status).toBe(401);
  });

  test("revoking other sessions leaves the current one intact", async () => {
    const wallet = Wallet.createRandom();
    const first = await challengeAndVerify(wallet);
    const second = await challengeAndVerify(wallet);

    const res = await app.request("/api/auth/sessions", {
      method: "DELETE",
      headers: { Cookie: `${SESSION_COOKIE}=${second.token}` },
    });
    expect(res.status).toBe(200);

    const stillOk = await app.request("/api/auth/me", {
      headers: { Cookie: `${SESSION_COOKIE}=${second.token}` },
    });
    expect(stillOk.status).toBe(200);

    const revoked = await app.request("/api/auth/me", {
      headers: { Cookie: `${SESSION_COOKIE}=${first.token}` },
    });
    expect(revoked.status).toBe(401);
  });

  test("cannot revoke the current session via DELETE /sessions/:id", async () => {
    const wallet = Wallet.createRandom();
    const { token, body } = await challengeAndVerify(wallet);
    const res = await app.request(`/api/auth/sessions/${body.session.id}`, {
      method: "DELETE",
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(res.status).toBe(400);
  });

  test("sliding renewal rotates the session cookie", async () => {
    const wallet = Wallet.createRandom();
    const { token } = await challengeAndVerify(wallet);
    const { sessions } = getCollections(memory as unknown as Db);
    const session = await sessions.findOne({ tokenHash: hashToken(token) });
    expect(session).toBeTruthy();

    const stale = new Date(Date.now() - 6 * 60_000);
    await sessions.updateOne({ _id: session!._id }, { $set: { lastSeenAt: stale } });

    const renewed = await app.request("/api/auth/me", {
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(renewed.status).toBe(200);

    const setCookie = renewed.headers.get("set-cookie") || "";
    const match = setCookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
    expect(match).toBeTruthy();
    const newToken = match![1]!;
    expect(newToken).not.toBe(token);

    /* Old token stays valid for a short grace window after rotation — a page
       load fans out several concurrent requests on the pre-rotation cookie,
       and they must not 401 just because a sibling request rotated first. */
    const oldMeDuringGrace = await app.request("/api/auth/me", {
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(oldMeDuringGrace.status).toBe(200);

    const newMe = await app.request("/api/auth/me", {
      headers: { Cookie: `${SESSION_COOKIE}=${newToken}` },
    });
    expect(newMe.status).toBe(200);

    /* Past the grace window, the old token is dead. */
    await sessions.updateOne(
      { _id: session!._id },
      { $set: { prevTokenValidUntil: new Date(Date.now() - 1000) } },
    );
    const oldMeAfterGrace = await app.request("/api/auth/me", {
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(oldMeAfterGrace.status).toBe(401);

    const after = await sessions.findOne({ _id: session!._id });
    expect(after!.tokenHash).toBe(hashToken(newToken));
    expect(after!.createdAt.getTime()).toBe(session!.createdAt.getTime());
    expect(after!.accountId).toBeTruthy();
  });

  test("concurrent requests on a stale session all succeed despite rotation", async () => {
    /* Reproduces the reported "API is running" 401: a page load fans out
       several concurrent requests on one pre-rotation cookie. Before the
       grace window, any request whose lookup ran after a sibling's rotation
       write landed found no row for the old hash and 401ed. */
    const wallet = Wallet.createRandom();
    const { token } = await challengeAndVerify(wallet);
    const { sessions } = getCollections(memory as unknown as Db);
    const session = await sessions.findOne({ tokenHash: hashToken(token) });

    await sessions.updateOne(
      { _id: session!._id },
      { $set: { lastSeenAt: new Date(Date.now() - 6 * 60_000) } },
    );

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        app.request("/api/auth/me", { headers: { Cookie: `${SESSION_COOKIE}=${token}` } }),
      ),
    );
    for (const res of results) expect(res.status).toBe(200);
  });

  test("absolute lifetime cap revokes expired sessions", async () => {
    const wallet = Wallet.createRandom();
    const { token } = await challengeAndVerify(wallet);
    const { sessions } = getCollections(memory as unknown as Db);
    const session = await sessions.findOne({ tokenHash: hashToken(token) });
    expect(session).toBeTruthy();

    const ancient = new Date(Date.now() - SESSION_MAX_LIFETIME_MS - 60_000);
    await sessions.updateOne(
      { _id: session!._id },
      {
        $set: {
          createdAt: ancient,
          lastSeenAt: ancient,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      },
    );

    const res = await app.request("/api/auth/me", {
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(res.status).toBe(401);

    const after = await sessions.findOne({ _id: session!._id });
    expect(after!.revokedAt).toBeTruthy();
  });

  test("expired sliding TTL is rejected", async () => {
    const wallet = Wallet.createRandom();
    const { token } = await challengeAndVerify(wallet);
    const { sessions } = getCollections(memory as unknown as Db);
    await sessions.updateOne(
      { tokenHash: hashToken(token) },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    const res = await app.request("/api/auth/me", {
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(res.status).toBe(401);
  });

  test("clearAll revokes every session for the user", async () => {
    const wallet = Wallet.createRandom();
    const a = await challengeAndVerify(wallet);
    const b = await challengeAndVerify(wallet);

    const res = await app.request("/api/auth/clear", {
      method: "POST",
      headers: { Cookie: `${SESSION_COOKIE}=${b.token}` },
    });
    expect(res.status).toBe(200);

    for (const token of [a.token, b.token]) {
      const me = await app.request("/api/auth/me", {
        headers: { Cookie: `${SESSION_COOKIE}=${token}` },
      });
      expect(me.status).toBe(401);
    }
  });

  test("revoking a specific other session works", async () => {
    const wallet = Wallet.createRandom();
    const first = await challengeAndVerify(wallet);
    const second = await challengeAndVerify(wallet);

    const res = await app.request(`/api/auth/sessions/${first.body.session.id}`, {
      method: "DELETE",
      headers: { Cookie: `${SESSION_COOKIE}=${second.token}` },
    });
    expect(res.status).toBe(200);

    const gone = await app.request("/api/auth/me", {
      headers: { Cookie: `${SESSION_COOKIE}=${first.token}` },
    });
    expect(gone.status).toBe(401);
  });

  test("unknown session id returns 404", async () => {
    const wallet = Wallet.createRandom();
    const { token } = await challengeAndVerify(wallet);
    const res = await app.request(`/api/auth/sessions/${new ObjectId().toHexString()}`, {
      method: "DELETE",
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(res.status).toBe(404);
  });
});
