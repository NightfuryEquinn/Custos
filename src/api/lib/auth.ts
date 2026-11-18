import { getAddress, verifyMessage } from "ethers";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { createHash, randomBytes } from "node:crypto";
import { AUTH_MESSAGE_PREAMBLE, AUTH_MESSAGE_VERIFY_LINE } from "@/lib/auth-message";

export const SESSION_COOKIE = "ledger_session";
/** Long-lived id for this browser profile. Scopes same-device session revoke. */
export const DEVICE_COOKIE = "ledger_device";
export const DEVICE_TTL_MS = 365 * 24 * 60 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Absolute cap: no session may outlive this, regardless of sliding renewal. */
export const SESSION_MAX_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;

/** Whether this process is a production / Vercel deploy. */
function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
}

/** Generate a cryptographically random session or nonce token. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Hash a session token with SHA-256 for at-rest storage. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Generate a short-lived auth challenge nonce. */
export function generateNonce(): string {
  return randomBytes(16).toString("base64url");
}

/** Build the SIWE-style message users sign to prove key control. */
export function buildAuthMessage(address: string, nonce: string, uri: string): string {
  const normalized = getAddress(address);
  const issuedAt = new Date().toISOString();

  return [
    AUTH_MESSAGE_PREAMBLE,
    "",
    `Address: ${normalized}`,
    AUTH_MESSAGE_VERIFY_LINE,
    "",
    `URI: ${uri}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

/** Verify a wallet signature recovers the expected address. */
export function verifyAuthSignature(
  message: string,
  signature: string,
  expectedAddress: string,
): boolean {
  try {
    const recovered = verifyMessage(message, signature);

    return getAddress(recovered) === getAddress(expectedAddress);
  } catch {
    return false;
  }
}

/** Pin the signed-message URI; require APP_ORIGIN in production. */
export function getRequestUri(c: Context): string {
  const pinned = process.env.APP_ORIGIN?.trim();
  if (pinned) return pinned;

  if (isProductionRuntime()) {
    throw new HTTPException(500, {
      message: "APP_ORIGIN is required in production",
    });
  }

  try {
    return new URL(c.req.url).origin;
  } catch {
    return "http://localhost:3000";
  }
}

/** Resolve client IP from trusted proxy headers (prefer last XFF hop). */
export function getClientIp(c: Context): string {
  const trusted = c.req.header("x-real-ip") || c.req.header("cf-connecting-ip");
  if (trusted) return trusted.trim();
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",");

    return parts[parts.length - 1]!.trim() || "unknown";
  }

  return "unknown";
}

/** Truncate User-Agent for session metadata storage. */
export function getUserAgent(c: Context): string {
  return (c.req.header("user-agent") || "unknown").slice(0, 512);
}

/** Read the HttpOnly session cookie value. */
export function readSessionToken(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE);
}

/** Read this browser profile's device id, when one has been issued. */
export function readDeviceId(c: Context): string | undefined {
  return getCookie(c, DEVICE_COOKIE);
}

/** Whether the session cookie should set the Secure attribute. */
function shouldUseSecureCookie(c: Context): boolean {
  if (isProductionRuntime()) return true;
  const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (proto === "https") return true;
  try {
    return new URL(c.req.url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Cookie flags shared by the session and device cookies. */
function sessionCookieOptions(c: Context, maxAgeMs: number) {
  return {
    httpOnly: true,
    /* Secure in production/Vercel or when the request is HTTPS. Local HTTP
       dev leaves Secure off so the browser accepts the cookie. */
    secure: shouldUseSecureCookie(c),
    sameSite: "Lax" as const,
    path: "/",
    maxAge: Math.floor(maxAgeMs / 1000),
  };
}

/** Set the HttpOnly session cookie on the response. */
export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE, token, sessionCookieOptions(c, SESSION_TTL_MS));
}

/** Set the long-lived device id cookie. Not cleared on logout. */
export function setDeviceCookie(c: Context, deviceId: string): void {
  setCookie(c, DEVICE_COOKIE, deviceId, sessionCookieOptions(c, DEVICE_TTL_MS));
}

/** Clear the session cookie with the same attributes used to set it. */
export function clearSessionCookie(c: Context): void {
  const { httpOnly, secure, sameSite, path } = sessionCookieOptions(c, SESSION_TTL_MS);
  deleteCookie(c, SESSION_COOKIE, { httpOnly, secure, sameSite, path });
}

/** Map a User-Agent string to a short device label. */
export function parseDeviceLabel(userAgent: string): string {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "iOS device";
  if (/Android/i.test(userAgent)) return "Android device";
  if (/Macintosh|Mac OS/i.test(userAgent)) return "Mac";
  if (/Windows/i.test(userAgent)) return "Windows";
  if (/Linux/i.test(userAgent)) return "Linux";

  return "Unknown device";
}
