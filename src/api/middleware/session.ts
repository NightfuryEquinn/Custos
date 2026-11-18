import {
  SESSION_MAX_LIFETIME_MS,
  SESSION_TTL_MS,
  hashToken,
  readSessionToken,
  setSessionCookie,
} from "@/api/lib/auth";
import { unauthorized } from "@/api/lib/errors";
import { getCollections, getDb } from "@/db";
import { createMiddleware } from "hono/factory";
import { ObjectId } from "mongodb";

export type SessionVariables = {
  accountId: string;
  sessionId: string;
};

/**
 * Resolve the opaque account id for a session row.
 * Prefers session.accountId — trusted without a users lookup, since account
 * deletion (scripts/lib/purge-account.ts) removes the user's sessions in the
 * same purge, so a session row cannot outlive its account. Legacy
 * address-only sessions still need the users lookup to resolve accountId.
 */
async function resolveAccountId(session: {
  accountId?: string;
  address?: string;
}): Promise<string | null> {
  if (session.accountId && ObjectId.isValid(session.accountId)) {
    return session.accountId;
  }

  if (!session.address) return null;

  const { users } = getCollections(getDb());
  const user = await users.findOne({ address: session.address.toLowerCase() });

  return user ? user._id.toHexString() : null;
}

/** Require a valid session cookie and slide its expiry without changing the token. */
export const sessionAuth = createMiddleware<{ Variables: SessionVariables }>(async (c, next) => {
  const token = readSessionToken(c);
  if (!token) unauthorized("Session required. Sign in again.");

  const tokenHash = hashToken(token);
  const { sessions } = getCollections(getDb());
  const now = new Date();
  const session = await sessions.findOne({
    $or: [{ tokenHash }, { prevTokenHash: tokenHash, prevTokenValidUntil: { $gt: now } }],
    revokedAt: { $exists: false },
    expiresAt: { $gt: now },
  });

  if (!session) unauthorized("Session expired or invalid. Sign in again.");

  /* Matched on the current hash vs. a pre-change rotation's grace window.
     Only the current token slides; a grace match must not mint a new one. */
  const matchedCurrentHash = session.tokenHash === tokenHash;

  /* Sliding renewal must not extend a session forever: enforce an absolute cap. */
  const absoluteExpiry = session.createdAt.getTime() + SESSION_MAX_LIFETIME_MS;
  if (now.getTime() >= absoluteExpiry) {
    /* Awaited (not fire-and-forget): the request is rejecting anyway, and a
       serverless isolate can freeze right after the response flushes, so a
       `void` write here could silently never land. */
    await sessions.updateOne({ _id: session._id }, { $set: { revokedAt: now } });
    unauthorized("Session expired or invalid. Sign in again.");
  }

  const accountId = await resolveAccountId(session);
  if (!accountId) unauthorized("Session expired or invalid. Sign in again.");

  /* Backfill accountId onto legacy sessions that only stored address.
     Best-effort: a dropped write just means this session repeats the
     resolveAccountId address lookup next time, not a correctness issue,
     so it stays fire-and-forget rather than adding a round trip here. */
  if (!session.accountId) {
    void sessions.updateOne({ _id: session._id }, { $set: { accountId } }).catch(() => {
      /* best-effort — see above */
    });
  }

  c.set("accountId", accountId);
  c.set("sessionId", session._id.toHexString());

  /* Slide expiry on the current token only. Refreshing the same cookie
     value extends its maxAge; a lost response leaves the browser holding
     the token Mongo already trusts. prevTokenHash still matches sessions
     that rotated before renewal stopped issuing a new token. */
  if (
    matchedCurrentHash &&
    (!session.lastSeenAt || now.getTime() - session.lastSeenAt.getTime() > 5 * 60_000)
  ) {
    const renewedExpiry = Math.min(now.getTime() + SESSION_TTL_MS, absoluteExpiry);
    await sessions.updateOne(
      { _id: session._id, tokenHash },
      {
        $set: {
          lastSeenAt: now,
          expiresAt: new Date(renewedExpiry),
        },
      },
    );
    setSessionCookie(c, token);
    /* Persist activity on the user — session rows TTL away and cannot drive purge alone.
       Best-effort: worst case is a slightly stale lastSeenAt, not lost auth state. */
    const { users } = getCollections(getDb());
    void users
      .updateOne({ _id: new ObjectId(accountId) }, { $set: { lastSeenAt: now } })
      .catch(() => {
        /* best-effort — see above */
      });
  }

  await next();
});
