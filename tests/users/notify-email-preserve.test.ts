import { describe, expect, test } from "bun:test";
import { createApiApp } from "@/api/app";
import { SESSION_COOKIE } from "@/api/lib/auth";
import { Wallet, type HDNodeWallet } from "ethers";
import { useMemoryDb } from "../helpers/memory-db";

const app = createApiApp();

const SAVED_EMAIL = "keep@example.com";

/** Sign a challenge and return the session cookie plus wallet. */
async function signIn(wallet = Wallet.createRandom()): Promise<{
  cookie: string;
  wallet: HDNodeWallet;
}> {
  const challengeRes = await app.request("/api/auth/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: wallet.address }),
  });
  expect(challengeRes.status).toBe(200);
  const challenge = (await challengeRes.json()) as { message: string };
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

  return { cookie: `${SESSION_COOKIE}=${match![1]!}`, wallet };
}

/** Read the signed-in user from GET /users/me. */
async function getMe(cookie: string) {
  const res = await app.request("/api/users/me", { headers: { cookie } });
  expect(res.status).toBe(200);

  return (await res.json()) as {
    user: { address: string; codename: string; notifyEmail?: string };
  };
}

/** Save notifyEmail via PATCH /users/me. */
async function setNotifyEmail(cookie: string, notifyEmail: string) {
  const res = await app.request("/api/users/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ notifyEmail }),
  });
  expect(res.status).toBe(200);
}

describe("notify email persistence", () => {
  useMemoryDb();

  test("POST /users updates codename without clearing a saved notify email", async () => {
    const { cookie, wallet } = await signIn();
    await setNotifyEmail(cookie, SAVED_EMAIL);

    const postRes = await app.request("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        address: wallet.address,
        codename: "new-codename",
      }),
    });
    expect(postRes.status).toBe(200);
    const posted = (await postRes.json()) as { user: { codename: string; notifyEmail?: string } };
    expect(posted.user.codename).toBe("new-codename");
    expect(posted.user.notifyEmail).toBe(SAVED_EMAIL);

    const { user } = await getMe(cookie);
    expect(user.notifyEmail).toBe(SAVED_EMAIL);
    expect(user.codename).toBe("new-codename");
  });

  test("POST /users ignores a blank notifyEmail in the body", async () => {
    const { cookie, wallet } = await signIn();
    await setNotifyEmail(cookie, SAVED_EMAIL);

    const postRes = await app.request("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        address: wallet.address,
        codename: wallet.address.slice(0, 6).toLowerCase(),
        notifyEmail: "",
      }),
    });
    expect(postRes.status).toBe(200);

    const { user } = await getMe(cookie);
    expect(user.notifyEmail).toBe(SAVED_EMAIL);
  });

  test("re-auth verify leaves an existing notify email intact", async () => {
    const { cookie, wallet } = await signIn();
    await setNotifyEmail(cookie, SAVED_EMAIL);

    const { cookie: nextCookie } = await signIn(wallet);
    const { user } = await getMe(nextCookie);
    expect(user.notifyEmail).toBe(SAVED_EMAIL);
  });

  test("GET /users/me sends Cache-Control: no-store", async () => {
    const { cookie } = await signIn();
    await setNotifyEmail(cookie, SAVED_EMAIL);

    const res = await app.request("/api/users/me", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");

    const { user } = (await res.json()) as {
      user: { notifyEmail?: string };
    };
    expect(user.notifyEmail).toBe(SAVED_EMAIL);
  });
});
