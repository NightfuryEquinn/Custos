/**
 * How long a locally-saved account may be trusted for an offline boot
 * (see Root.tsx's local-first boot path) before it is signed out rather
 * than kept around indefinitely.
 *
 * This bound isn't a meaningful attack mitigation — an attacker who has the
 * device already has the vault, and server-side session revocation can't
 * protect already-synced ciphertext either way under this app's E2EE model.
 * What it buys: a revoked/banned account can't run a permanent offline read
 * mirror, and the offline write queue can't accumulate months of writes
 * that were always going to fail once they finally reach the server.
 *
 * Matches values that already exist elsewhere for the same reason: the
 * server's sliding session TTL (`SESSION_TTL_MS`, src/api/lib/auth.ts) and
 * the read cache's own entry TTL (`cipher-cache.ts`) are both 30 days.
 */
const TRUST_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const KEY = "ledger:session-verified-at";

function readMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, number>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Record that the server confirmed this address's session just now. */
export function markSessionVerified(address: string): void {
  const map = readMap();
  map[address.toLowerCase()] = Date.now();
  writeMap(map);
}

/** Whether this address's last server confirmation is still within the trust window. */
export function isSessionTrustFresh(address: string): boolean {
  const at = readMap()[address.toLowerCase()];
  return typeof at === "number" && Date.now() - at < TRUST_WINDOW_MS;
}
