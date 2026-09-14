const keys = new Map<string, CryptoKey>();
const seriesKeys = new Map<string, CryptoKey>();

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

export const ledgerKeyStore = {
  get(address: string): CryptoKey | null {
    return keys.get(normalizeAddress(address)) ?? null;
  },

  set(address: string, key: CryptoKey): void {
    keys.set(normalizeAddress(address), key);
  },

  clear(address?: string): void {
    if (address) keys.delete(normalizeAddress(address));
    else keys.clear();
  },

  isUnlocked(address: string): boolean {
    return keys.has(normalizeAddress(address));
  },
};

/** Non-extractable HMAC key used to derive recurring-expense series keys. */
export const seriesKeyStore = {
  get(address: string): CryptoKey | null {
    return seriesKeys.get(normalizeAddress(address)) ?? null;
  },

  set(address: string, key: CryptoKey): void {
    seriesKeys.set(normalizeAddress(address), key);
  },

  clear(address?: string): void {
    if (address) seriesKeys.delete(normalizeAddress(address));
    else seriesKeys.clear();
  },
};
