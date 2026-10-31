/* Signup choice is versioned separately from legacy sharing preferences. */
const choiceMadeKey = (addr: string) => `ledger:personalization-choice-v1:${addr.toLowerCase()}`;

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
