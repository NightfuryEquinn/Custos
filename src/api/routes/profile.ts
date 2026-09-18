import { cacheDel, cacheGet, cacheSet } from "@/api/lib/cache";
import { notFound } from "@/api/lib/errors";
import { serializeDoc } from "@/api/lib/serialize";
import type { SessionVariables } from "@/api/middleware/session";
import { sessionAuth } from "@/api/middleware/session";
import { getCollections, getDb } from "@/db";
import { defaultProfile, updateProfileSchema, type TourPreference } from "@/schemas/profile";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { ObjectId } from "mongodb";

const PROFILE_CACHE_TTL_MS = 30_000;

export const profileRoutes = new Hono<{ Variables: SessionVariables }>();

profileRoutes.use("*", sessionAuth);

/** Build the in-memory profile cache key for an account. */
function profileCacheKey(accountId: string) {
  return `profile:${accountId}`;
}

/** Expose only UI state + createdAt (ownership keys stay server-side). */
function serializeProfile(doc: {
  _id: import("mongodb").ObjectId;
  currentMonth: string;
  tourPreference?: TourPreference;
  toursSeen?: string[];
  termsVersion?: string;
  accent?: string;
  surface?: string;
  navTabs?: string[];
  navOrder?: string[];
  createdAt: Date;
}) {
  const serialized = serializeDoc(doc);

  return {
    id: serialized.id,
    currentMonth: serialized.currentMonth,
    /* Profiles written before onboarding moved server-side have neither field;
       the defaults read as "never asked", so those users get the prompt once. */
    tourPreference: serialized.tourPreference ?? "pending",
    toursSeen: serialized.toursSeen ?? [],
    /* Undefined reads as "never accepted" on the client. */
    termsVersion: serialized.termsVersion,
    /* Undefined reads as the default "clay" accent on the client. */
    accent: serialized.accent,
    /* Undefined reads as the default "bone" surface on the client. */
    surface: serialized.surface,
    /* Undefined means "never customized" — the client falls back to the
       built-in nav defaults. */
    navTabs: serialized.navTabs,
    navOrder: serialized.navOrder,
    /* Account age tells the client whether to announce release notes. */
    createdAt: serialized.createdAt.toISOString(),
  };
}

/** Load or create the ledger profile for an account (with short TTL cache). */
async function getOrCreateProfile(accountId: string) {
  const cached = cacheGet<Awaited<ReturnType<typeof fetchProfile>>>(profileCacheKey(accountId));
  if (cached) return cached;

  const profile = await fetchProfile(accountId);
  cacheSet(profileCacheKey(accountId), profile, PROFILE_CACHE_TTL_MS);
  return profile;
}

/** Fetch the profile document, inserting a default when missing. */
async function fetchProfile(accountId: string) {
  const { ledgerProfiles } = getCollections(getDb());
  const existing = await ledgerProfiles.findOne({ accountId });
  if (existing) return existing;

  const now = new Date();
  const seed = defaultProfile(accountId);
  try {
    const result = await ledgerProfiles.insertOne({
      _id: new ObjectId(),
      ...seed,
      createdAt: now,
      updatedAt: now,
    });

    const created = await ledgerProfiles.findOne({ _id: result.insertedId });
    if (!created) throw new Error("Failed to create ledger profile");
    return created;
  } catch (err) {
    /* Check-then-act race: two concurrent first loads for the same
       never-seeded account (e.g. two tabs, or a page load racing a queue
       drain on reconnect) can both see no profile and both reach this
       insertOne. `ledgerProfiles {accountId}` is a unique index, so exactly
       one wins — the loser previously threw a 500 here instead of just
       reading what the winner created. */
    if ((err as { code?: number }).code !== 11000) throw err;
    const existing = await ledgerProfiles.findOne({ accountId });
    if (existing) return existing;
    throw err;
  }
}

/** Drop the cached profile for an account after a write. */
function invalidateProfile(accountId: string) {
  cacheDel(profileCacheKey(accountId));
}

profileRoutes.get("/", async (c) => {
  const accountId = c.get("accountId");
  const profile = await getOrCreateProfile(accountId);
  c.header("Cache-Control", "private, max-age=30");
  return c.json({ profile: serializeProfile(profile) });
});

profileRoutes.patch("/", zValidator("json", updateProfileSchema), async (c) => {
  const accountId = c.get("accountId");
  const body = c.req.valid("json");
  const { ledgerProfiles } = getCollections(getDb());

  await fetchProfile(accountId);

  const updated = await ledgerProfiles.findOneAndUpdate(
    { accountId },
    { $set: { ...body, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  /* After the write, not before — invalidating first left a 30s window where
     a concurrent GET could repopulate the cache with the stale pre-write doc. */
  invalidateProfile(accountId);

  if (!updated) notFound("Profile not found");
  return c.json({ profile: serializeProfile(updated) });
});
