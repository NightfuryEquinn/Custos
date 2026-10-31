/**
 * Single source for legal/compliance copy shown in the Terms modal, the Data
 * & Privacy sharing card, and the signup consent gate — so a wording change
 * lands in every surface instead of drifting across separate copies (which
 * is exactly how the retired sharing claim below drifted in the first
 * place).
 */

/** Bump when the Terms text changes in a way that needs re-acceptance. */
export const TERMS_VERSION = "2026-10-31";
export const TERMS_UPDATED = "October 31, 2026";

export const SHARING_LEGAL_PARAGRAPH =
  "Personalised suggestions are optional. Existing records are analysed on your unlocked device. If you opt in, limited feature activity and suggestion feedback sync encrypted for up to 30 days. Custos cannot read this history; the server sees account ownership, storage day, event counts and sync timing. Turning off stops collection and erases history; offline deletion completes when devices reconnect. No behaviour is sent to analytics or an AI provider. Core features and existing insights remain free either way.";
export const SHARING_SIGNUP_TITLE = "Optional personalised suggestions";
export const SHARING_SIGNUP_DESCRIPTION =
  "Allow on-device suggestions to learn from limited feature use and feedback, with encrypted history synced for up to 30 days. Turning off erases recommendation history. A fresh opt-in is required; you can change this in Data & privacy. If unavailable on this host, enable later from Suggestions.";
export const SIGNUP_LEAD =
  "Custos is free on the official host with full features. Optional tips help keep it running.";
