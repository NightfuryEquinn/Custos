import type { IdentityRecord, LegacyIdentitySecrets } from "@/frontend/lib/types";
import { ledgerKeyStore, seriesKeyStore } from "@/frontend/lib/crypto/key-store";
import { sessionSecrets } from "@/frontend/auth/lib/session-secrets";
import { clearCipherCacheForAddress } from "@/frontend/lib/pwa/cipher-cache";
import { clearOutboxForAddress } from "@/frontend/lib/sync/outbox";

/** In-memory hold for plaintext keys scrubbed from localStorage until vaulted. */
const pendingLegacy = new Map<string, LegacyIdentitySecrets>();

/** Normalize address for map lookups. */
function addrKey(address: string): string {
  return address.toLowerCase();
}

/** Strip deprecated plaintext secrets from a stored identity record. */
function sanitizeRecord(idn: IdentityRecord): IdentityRecord {
  const sanitized: IdentityRecord = {
    address: idn.address,
    codename: idn.codename,
    injected: !!idn.injected,
    lastSeen: idn.lastSeen ?? Date.now(),
  };
  if (idn.vault) sanitized.vault = idn.vault;

  return sanitized;
}

/** Capture legacy plaintext for same-session migration, then drop from disk shape. */
function captureLegacy(idn: IdentityRecord): void {
  if (idn.vault || idn.injected) {
    pendingLegacy.delete(addrKey(idn.address));

    return;
  }
  if (idn.mnemonic && idn.privateKey) {
    pendingLegacy.set(addrKey(idn.address), {
      mnemonic: idn.mnemonic,
      privateKey: idn.privateKey,
    });
  }
}

/** Merge pending in-memory legacy secrets onto a sanitized record. */
function withPendingLegacy(idn: IdentityRecord): IdentityRecord {
  const legacy = pendingLegacy.get(addrKey(idn.address));
  if (!legacy || idn.vault) return idn;

  return { ...idn, ...legacy };
}

/** Drop pending legacy secrets after successful vault migration. */
function clearPendingLegacy(address: string): void {
  pendingLegacy.delete(addrKey(address));
}

export const identityStorage = {
  list(): IdentityRecord[] {
    try {
      const raw = JSON.parse(localStorage.getItem("ledger:identities") || "[]") as IdentityRecord[];
      for (const idn of raw) captureLegacy(idn);
      const cleaned = raw.map(sanitizeRecord);
      /* Rewrite storage to scrub any leftover plaintext keys. */
      if (JSON.stringify(raw) !== JSON.stringify(cleaned)) {
        localStorage.setItem("ledger:identities", JSON.stringify(cleaned));
      }

      return cleaned.map(withPendingLegacy);
    } catch {
      return [];
    }
  },
  save(list: IdentityRecord[]) {
    for (const idn of list) {
      if (idn.vault) clearPendingLegacy(idn.address);
    }
    localStorage.setItem("ledger:identities", JSON.stringify(list.map(sanitizeRecord)));
  },
  /** Persist an identity without plaintext secrets. */
  upsert(idn: IdentityRecord) {
    if (idn.vault) clearPendingLegacy(idn.address);
    const sanitized = sanitizeRecord(idn);
    const list = identityStorage
      .list()
      .map(sanitizeRecord)
      .filter((i) => i.address.toLowerCase() !== idn.address.toLowerCase());
    list.unshift(sanitized);
    identityStorage.save(list);
  },
  find(addr: string) {
    return identityStorage
      .list()
      .find((i) => i.address.toLowerCase() === (addr || "").toLowerCase());
  },
  session() {
    return localStorage.getItem("ledger:session");
  },
  setSession(addr: string | null) {
    if (addr) localStorage.setItem("ledger:session", addr);
    else localStorage.removeItem("ledger:session");
  },
};

/**
 * Clear ledger keys, session secrets, localStorage, IndexedDB cipher cache,
 * and any pending offline writes. This is the explicit "Clear local data"
 * action (Data & privacy) — a deliberate, user-initiated wipe, so it's the
 * one place unsynced offline writes are also discarded rather than kept for
 * a later sync; every other sign-out path leaves the outbox intact.
 */
export function clearAllLocalData(): void {
  /* Every identity ever used on this device, not just the current session —
     once `ledger:identities` is wiped below, nothing can enumerate the rest
     again, and their IndexedDB rows would otherwise sit there permanently.
     `list()` swallows a JSON parse error and returns `[]` on a corrupt
     `ledger:identities` — seed with the current session address too, so a
     corrupt list never silently skips the one address this action is most
     likely being run to actually clear. */
  const knownAddresses = new Set(identityStorage.list().map((i) => i.address));
  const current = identityStorage.session();
  if (current) knownAddresses.add(current);
  pendingLegacy.clear();
  ledgerKeyStore.clear();
  seriesKeyStore.clear();
  sessionSecrets.clearAll();
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith("ledger:")) keys.push(key);
  }
  keys.forEach((key) => localStorage.removeItem(key));
  for (const addr of knownAddresses) {
    void clearCipherCacheForAddress(addr);
    void clearOutboxForAddress(addr);
  }
}
