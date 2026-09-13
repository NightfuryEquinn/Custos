/**
 * Single source for legal/compliance copy shown in the Terms modal, the Data
 * & Privacy sharing card, and the signup consent gate — so a wording change
 * lands in every surface instead of drifting across separate copies (which
 * is exactly how the retired sharing claim below drifted in the first
 * place).
 */

/** Bump when the Terms text changes in a way that needs re-acceptance. */
export const TERMS_VERSION = "2026-09-13";
export const TERMS_UPDATED = "September 13, 2026";

export const SHARING_LEGAL_PARAGRAPH =
  "Custos does not share your data with anyone, and never has. The data-sharing switch under " +
  "Account → Data & privacy only records a preference for a possible future opt-in programme " +
  "that does not exist yet — if one is ever built, it will be described here and announced " +
  "before any data leaves your device. Transaction amounts, titles, and notes stay end-to-end " +
  "encrypted either way. Custos is free on the official host with full features; optional " +
  "tips and a monthly Supporter subscription help fund it, and neither gates anything in " +
  "the core ledger.";

export const SHARING_CARD_TITLE = "Share Anonymized Category Totals";

export const SHARING_CARD_DESCRIPTION =
  "Nothing is shared today, and nothing has ever been shared — this switch only records a " +
  "preference for a possible future opt-in programme. If one is ever built, Custos will " +
  "describe it here and announce it before any data leaves your device. Your name, wallet " +
  "address, notes, and decrypted amounts always stay end-to-end encrypted.";

export const SHARING_ON_STATUS = "On — recorded as a preference; nothing is sent anywhere yet";
export const SHARING_OFF_STATUS = "Off — nothing is shared";

export const SHARING_SIGNUP_TITLE = "Optional data sharing";

export const SHARING_SIGNUP_DESCRIPTION =
  "Record a preference for a possible future opt-in programme sharing de-identified category " +
  "totals — not your name, wallet address, notes, or decrypted ledger amounts. Nothing is " +
  "shared today; change this anytime under Account → Data & privacy.";

export const SIGNUP_LEAD =
  "Custos is free on the official host with full features. Optional tips and a monthly " +
  "Supporter subscription help keep the lights on — never a paywall on the ledger itself.";
