# Custos v5.0.0 — release plan

Shipped: zero-tap Face ID/Touch ID unlock, and the "no-subscription
monetization plan" (see `MONETIZATION_PLAN.md` and
`custos_no-sub_monetization_e36abb9e.plan.md` in this folder) — Phases 0
through 5, folded into one release.

## What shipped

**Sign-in**

- The unlock screen prompts Face ID / Touch ID on its own instead of waiting
  for a button press; a returning device with a lapsed server session skips
  the welcome screen straight to that identity's unlock prompt.
- Browsers that require a gesture, or a dismissed prompt, fall back silently
  to the existing button and passphrase field.

**Truth pass (Phase 0)**

- Retired the unimplementable claim that Custos shares de-identified category
  totals with research/advertising partners on consent — nothing ever sent
  anything, since the server stores ciphertext and category totals are
  computed client-side. `src/lib/legal.ts` is now the single source for this
  copy across the Terms modal, Data & Privacy, and the signup consent gate.
- `termsVersion` on `ledger_profiles`, recorded server-side, with a blocking
  `TermsGate` in `Root.tsx` (not `AuthScreen`, which never renders for an
  existing session) so re-acceptance is asked once and follows the account
  across every device.
- Fixed a stale "Sched Ledger" brand reference in the license text, and a
  30-second stale-cache window in `PATCH /profile` (cache was invalidated
  before the write instead of after).

**Support & Lifetime perk (Phases 1-2)**

- `Account → Support Custos`: tips (Ko-fi, GitHub Sponsors) and a one-time
  Lifetime unlock (Lemon Squeezy, Stripe fallback) — placeholder URLs in
  `src/lib/support-links.ts` until real accounts are wired up.
- `supporterSince` granted manually via `scripts/grant-supporter.ts` (no
  webhook, no provider SDK) — a supporter badge next to the account name, and
  a choice of accent colors (`ledger_profiles.accent`, client-side gate only).
- Fixed a latent bug the accent perk would have made visible: `getAccent()`
  was a bare `getComputedStyle` read with no re-render subscription, so
  charts already failed to repaint on a dark-mode flip. Accent is now
  `ThemeProvider` context state.

**Marketing site (Phases 3-4)**

- `website/offers.html`: the same tip/Lifetime links plus 2-3 placeholder
  affiliate cards, with the commission disclosure above the fold.
- `website/services.html`: fixed-price bands for self-host setup, private
  deployment, an E2EE/wallet-auth workshop, and custom privacy work.
- Both linked from the footer and added to `website/sitemap.xml`.

**Release mechanics (Phase 5)**

- Version 4.5.5 → 5.0.0 in all six places.
- `RELEASE_NOTES` rewritten to cover both halves of the release.
- `tests/whats-new/release-notes.test.ts` now also checks `package.json`'s
  version and all three `website/index.html` occurrences, closing the gap
  that let a partial bump pass `bun test` green.

## Before this goes live

- Swap the placeholder Ko-fi / GitHub Sponsors / Lemon Squeezy / Stripe URLs
  in `src/lib/support-links.ts` and `website/offers.html` for real accounts.
- Replace the two placeholder affiliate cards in `offers.html` with real,
  disclosed programs.
- Confirm the Lifetime checkout actually collects the wallet address as a
  required custom field — `scripts/grant-supporter.ts` looks users up by it.

## Explicitly not in this release

Subscriptions, trials, seat or usage meters. An in-app ad SDK. A payment
webhook (manual grant only, for now — see the `ponytail:` comment in
`scripts/grant-supporter.ts` for the upgrade path). Any category-total or
aggregate pipeline. Paywalls on Schedule, Insights, encryption, exports, or
backups. Bank aggregation. White-label. A third-party ad network.
