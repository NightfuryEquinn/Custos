/*
 * Local cache of the third-party data-sharing consent flag.
 * The server record (GET/PATCH /api/consent) is the source of truth;
 * this cache only seeds the toggle before the network round-trip resolves.
 */

const consentKey = (addr: string) => `ledger:consent:${(addr || "").toLowerCase()}`;

const choiceMadeKey = (addr: string) => `ledger:sharing-choice-made:${(addr || "").toLowerCase()}`;

/** Read cached opt-in flag for an address. */
export function getConsent(addr: string): boolean {
  try {
    return localStorage.getItem(consentKey(addr)) === "true";
  } catch {
    return false;
  }
}

/** Cache the opt-in flag locally for an address. */
export function setConsent(addr: string, value: boolean): void {
  try {
    localStorage.setItem(consentKey(addr), value ? "true" : "false");
  } catch {
    /* ignore */
  }
}

/** Whether this browser already completed the signup sharing choice for an address. */
export function hasSharingChoiceMade(addr: string): boolean {
  try {
    return localStorage.getItem(choiceMadeKey(addr)) === "1";
  } catch {
    return false;
  }
}

/** Mark that the user completed the signup sharing opt-in/out choice. */
export function markSharingChoiceMade(addr: string): void {
  try {
    localStorage.setItem(choiceMadeKey(addr), "1");
  } catch {
    /* ignore */
  }
}
