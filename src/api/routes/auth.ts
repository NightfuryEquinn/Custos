import {
  SESSION_TTL_MS,
  buildAuthMessage,
  clearSessionCookie,
  generateNonce,
  generateToken,
  getClientIp,
  getRequestUri,
  getUserAgent,
  hashToken,
  parseDeviceLabel,
  readSessionToken,
  setSessionCookie,
  verifyAuthSignature,
} from "@/api/lib/auth";
import { badRequest, notFound, unauthorized } from "@/api/lib/errors";
import { authChallengeRateLimit, authVerifyRateLimit } from "@/api/middleware/rate-limit";
import type { SessionVariables } from "@/api/middleware/session";
import { sessionAuth } from "@/api/middleware/session";
import type { SessionDocument } from "@/db/collections";
import { getCollections, getDb } from "@/db";
import { authChallengeSchema, authVerifySchema } from "@/schemas/auth";
import { objectIdSchema } from "@/schemas/common";
import { zValidator } from "@hono/zod-validator";
import { getAddress } from "ethers";
import { Hono } from "hono";
import { ObjectId, type Filter } from "mongodb";

export const authRoutes = new Hono<{ Variables: SessionVariables }>();

/**
 * Session ownership filter: prefer accountId, also match legacy address-only rows.
 */
function sessionOwnershipFilter(accountId: string, address?: string): Filter<SessionDocument> {
  if (!address) return { accountId };
  return { $or: [{ accountId }, { address }, { address: address.toLowerCase() }] };
}

authRoutes.post(
  "/challenge",
  authChallengeRateLimit,
  zValidator("json", authChallengeSchema),
  async (c) => {
    const { address } = c.req.valid("json");
    const normalized = getAddress(address).toLowerCase();
    const nonce = generateNonce();
    const uri = getRequestUri(c);
    const message = buildAuthMessage(normalized, nonce, uri);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60_000);

    const { authNonces } = getCollections(getDb());
    await authNonces.insertOne({
      _id: new ObjectId(),
      address: normalized,
      nonce,
      message,
      expiresAt,
      createdAt: now,
    });

    return c.json({ message, nonce, expiresAt: expiresAt.toISOString(), uri });
  },
);

authRoutes.post("/verify", authVerifyRateLimit, zValidator("json", authVerifySchema), async (c) => {
  const { address, message, signature } = c.req.valid("json");
  const normalized = getAddress(address).toLowerCase();

  if (!verifyAuthSignature(message, signature, normalized)) {
    badRequest("Signature verification failed. Make sure you signed with the correct wallet.");
  }

  const now = new Date();
  const { authNonces, sessions, users } = getCollections(getDb());
  /* Atomically claim the nonce so concurrent verify requests cannot reuse it. */
  const nonceDoc = await authNonces.findOneAndUpdate(
    {
      address: normalized,
      message,
      usedAt: { $exists: false },
      expiresAt: { $gt: now },
    },
    { $set: { usedAt: now } },
  );

  if (!nonceDoc) badRequest("Sign-in challenge expired or invalid. Request a new one.");

  /* Upsert user first so the session can store the opaque accountId. */
  const user = await users.findOneAndUpdate(
    { address: normalized },
    {
      $set: { lastSeenAt: now },
      $setOnInsert: {
        address: normalized,
        codename: normalized.slice(0, 6),
        notifyEmail: "",
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true, returnDocument: "after" },
  );

  if (!user) badRequest("Could not create account. Try again.");

  const accountId = user._id.toHexString();
  const token = generateToken();
  const tokenHash = hashToken(token);
  const ip = getClientIp(c);
  const userAgent = getUserAgent(c);

  /* Revoke this account's existing active session(s) on the same device
     (same User-Agent) before inserting a fresh one. Without this, a login
     that only happens because the browser lost its cookie (private mode,
     Safari's cap on script-set cookies, a partial "clear site data") stacks
     an indistinguishable new row in Active Sessions instead of replacing the
     old one — the old row was still valid, just orphaned from its cookie.
     A different real device (different User-Agent) is unaffected. */
  await sessions.updateMany(
    {
      ...sessionOwnershipFilter(accountId, normalized),
      userAgent,
      revokedAt: { $exists: false },
    },
    { $set: { revokedAt: now } },
  );

  const sessionResult = await sessions.insertOne({
    _id: new ObjectId(),
    accountId,
    tokenHash,
    userAgent,
    ip,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
  });

  setSessionCookie(c, token);

  return c.json({
    account: {
      address: normalized,
      codename: user.codename || normalized.slice(0, 6),
      injected: false,
    },
    session: {
      id: sessionResult.insertedId.toHexString(),
      device: parseDeviceLabel(userAgent),
      current: true,
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
    },
  });
});

authRoutes.get("/me", sessionAuth, async (c) => {
  const accountId = c.get("accountId");
  const sessionId = c.get("sessionId");
  const { users, sessions } = getCollections(getDb());

  const user = await users.findOne({ _id: new ObjectId(accountId) });
  const session = await sessions.findOne({ _id: new ObjectId(sessionId) });

  if (!user || !session || session.revokedAt)
    unauthorized("Session expired or invalid. Sign in again.");

  return c.json({
    account: {
      address: user.address,
      codename: user.codename || user.address.slice(0, 6),
      injected: false,
    },
    session: {
      id: sessionId,
      device: parseDeviceLabel(session.userAgent),
      current: true,
      createdAt: session.createdAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
    },
  });
});

authRoutes.post("/logout", async (c) => {
  const token = readSessionToken(c);
  if (token) {
    const { sessions } = getCollections(getDb());
    await sessions.updateOne(
      { tokenHash: hashToken(token), revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date() } },
    );
  }
  clearSessionCookie(c);
  return c.json({ ok: true });
});

authRoutes.get("/sessions", sessionAuth, async (c) => {
  const accountId = c.get("accountId");
  const sessionId = c.get("sessionId");
  const { sessions, users } = getCollections(getDb());
  const user = await users.findOne({ _id: new ObjectId(accountId) });

  const docs = await sessions
    .find({
      ...sessionOwnershipFilter(accountId, user?.address),
      revokedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    })
    .sort({ lastSeenAt: -1 })
    .toArray();

  return c.json({
    sessions: docs.map((s) => ({
      id: s._id.toHexString(),
      device: parseDeviceLabel(s.userAgent),
      ip: s.ip === "unknown" ? "" : s.ip.replace(/\d+$/, "•••"),
      current: s._id.toHexString() === sessionId,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
    })),
  });
});

authRoutes.delete("/sessions", sessionAuth, async (c) => {
  const accountId = c.get("accountId");
  const sessionId = c.get("sessionId");
  const { sessions, users } = getCollections(getDb());
  const user = await users.findOne({ _id: new ObjectId(accountId) });

  await sessions.updateMany(
    {
      ...sessionOwnershipFilter(accountId, user?.address),
      _id: { $ne: new ObjectId(sessionId) },
      revokedAt: { $exists: false },
    },
    { $set: { revokedAt: new Date() } },
  );

  return c.json({ ok: true });
});

authRoutes.delete("/sessions/:id", sessionAuth, async (c) => {
  const accountId = c.get("accountId");
  const sessionId = c.get("sessionId");
  const parsed = objectIdSchema.safeParse(c.req.param("id"));
  if (!parsed.success) notFound("Session not found");

  const targetId = parsed.data;
  if (targetId === sessionId)
    badRequest("Cannot revoke your current session from here. Sign out instead.");

  const { sessions, users } = getCollections(getDb());
  const user = await users.findOne({ _id: new ObjectId(accountId) });
  const result = await sessions.updateOne(
    {
      _id: new ObjectId(targetId),
      ...sessionOwnershipFilter(accountId, user?.address),
      revokedAt: { $exists: false },
    },
    { $set: { revokedAt: new Date() } },
  );

  if (result.matchedCount === 0) notFound("Session not found");
  return c.json({ ok: true });
});

authRoutes.post("/clear", sessionAuth, async (c) => {
  const accountId = c.get("accountId");
  const { sessions, users } = getCollections(getDb());
  const user = await users.findOne({ _id: new ObjectId(accountId) });
  const now = new Date();

  await sessions.updateMany(
    {
      ...sessionOwnershipFilter(accountId, user?.address),
      revokedAt: { $exists: false },
    },
    { $set: { revokedAt: now } },
  );

  clearSessionCookie(c);
  return c.json({ ok: true, cleared: ["session", "cookie"] });
});
