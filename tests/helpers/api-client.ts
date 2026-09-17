import { SESSION_COOKIE } from "@/api/lib/auth";
import { Wallet, type HDNodeWallet } from "ethers";
import type { Hono } from "hono";

/** Sign in a fresh wallet (or one you pass in) and return its session cookie header value. */
export async function signIn(
  app: Hono,
  wallet: HDNodeWallet = Wallet.createRandom(),
): Promise<string> {
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

  return `${SESSION_COOKIE}=${match![1]!}`;
}

/** PATCH /api/profile with an arbitrary body and return status + parsed JSON. */
export async function patchProfile<T = unknown>(
  app: Hono,
  cookie: string,
  body: unknown,
): Promise<{ status: number; json: T }> {
  const res = await app.request("/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  });

  return { status: res.status, json: (await res.json()) as T };
}

/** Create a wallet for the signed-in account and return its id. */
export async function createWallet(
  app: Hono,
  cookie: string,
  payload = "wallet-ciphertext",
): Promise<string> {
  const res = await app.request("/api/wallets", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ currency: "MYR", enc: 1, payload }),
  });
  const { wallet } = (await res.json()) as { wallet: { id: string } };

  return wallet.id;
}
