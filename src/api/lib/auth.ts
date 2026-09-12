import { getAddress, verifyMessage } from "ethers";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE = "ledger_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Absolute cap: no session may outlive this, regardless of sliding renewal. */
export const SESSION_MAX_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
export const NONCE_TTL_MS = 5 * 60 * 1000;
/**
 * How long the pre-rotation token hash stays valid after a sliding-renewal
 * rotation. A page load fans out several concurrent requests on the same
 * cookie; without this window, any request whose session lookup runs after
 * a sibling's rotation write finds no matching row and 401s.
 */
export const SESSION_ROTATION_GRACE_MS = 30 * 1000;

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
    "Custos wants you to sign in with your Web3 identity.",
    "",
    `Address: ${normalized}`,
    "Sign in to verify you control this key. This will not send a transaction or cost gas.",
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

/** Set the HttpOnly session cookie on the response. */
export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    /* Secure in production/Vercel or when the request is HTTPS. Local HTTP
       dev leaves Secure off so the browser accepts the cookie. */
    secure: shouldUseSecureCookie(c),
    sameSite: "Lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

/** Clear the session cookie. */
export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
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
