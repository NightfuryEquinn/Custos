/**
 * Client-minted document id — 12 random bytes as 24 lowercase hex chars,
 * mirroring `randomObjectId()` in src/api/lib/ids.ts (deliberately no
 * embedded timestamp, so the id never leaks creation time). Matches
 * `objectIdSchema` (src/schemas/ids.ts) so the server accepts it verbatim.
 *
 * Minted client-side so an offline create is final — with its real,
 * permanent id — the instant the user saves, rather than waiting for a
 * round trip that may not happen for a while.
 */
export function clientObjectId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
