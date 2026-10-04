# Custos redesign coverage

The visual rules in `website/site.css`, `src/frontend/styles/ledger.css`, and `src/frontend/styles/journal.css` apply across the surfaces below. `tests/frontend/layout-tokens.test.ts` keeps the breakpoints and the spacing scale from drifting.

## Layout rules

**Width tiers.** Every width media query is a tier boundary: phone ≤639px, tablet 640–1023px, laptop 1024–1279px, desktop ≥1280px, plus ≤379px for the smallest phones. The same tiers apply to the app and the public site. JS that reads a breakpoint uses the same values (`LedgerApp.tsx`, `views/index.tsx`).

**Spacing scale.** `padding`, `margin`, and `gap` use multiples of 4px (`--sp-1` to `--sp-7` are 4 to 32px), with 1px and 2px allowed. A line that must be off the grid says why with an `off-grid` comment.

**One edge.** Row text, glyphs, and dividers sit on the page content edge. Only a hover or focus fill reaches past it, drawn by a `::before` that extends 12px (`--row-bleed`) beyond the row, so the fill never touches the text. Buttons that carry their own fill keep at least 8px inline padding, and icon-only buttons are 32px (44px on touch pointers) with the icon centred.

**Dialogs.** Head, body, and footer share one inset per tier (`--modal-pad`: 24px laptop and desktop, 20px tablet, 16px phone). Only the footer carries the bottom safe-area padding. At ≤379px the footer stacks with the primary action first.

**Stylesheet order.** `src/frontend/styles/app.css` imports `ledger.css` and then `journal.css`. Importing them separately from `main.tsx` works in production builds, but the dev server emits them in reverse and the base file wins.

## Confirmations and feedback

| Action                                                                             | Confirmation                                                                     |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Delete transaction, event, to-do list or task, capital item, empty plan or vehicle | Dialog, then a second press ("Confirm Delete")                                   |
| Delete a recurring transaction or event                                            | Scope choice (this, future, all), then a second press                            |
| Delete a wallet, a vehicle with fill-ups, a plan with items, a list with tasks     | Dialog, type the name, then a second press                                       |
| Clear local data                                                                   | Dialog, type `CLEAR`, then a second press                                        |
| Revoke a session                                                                   | Dialog, then a second press                                                      |
| Archive an in-use category or subcategory                                          | One confirm (it is reversible with Restore)                                      |
| Mark a Capitals item unpaid after a cost was logged                                | One confirm (it clears the logged cost and unlinks the payment)                  |
| Restore an encrypted backup                                                        | One confirm, after the file is read and decrypted                                |
| Discard offline changes                                                            | One confirm                                                                      |
| Close an editor with unsaved edits                                                 | "Discard changes?" (Escape, backdrop, close button, and Cancel all ask)          |
| Apply Calculator budgets                                                           | Dialog listing old and new values; success is shown only after the save finishes |

A short notice confirms each save, delete, archive, and restore, and adds "syncs when online" while offline. A failed save or delete shows its reason inline in the dialog. Escape closes the topmost dialog, and Enter saves in every editor. Dialogs lock while a save is running.

## Surfaces

| Area          | Surfaces to inspect in browser                                                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Promotional   | Home hero, features, schedule, goals, privacy, stats, FAQ, stack, final CTA, footer; Offers; Services                                                                                                              |
| Shell         | Topbar, account menu, wallet and month controls, Open Custos index, Add sheet (incl. list, plan, category, fill-up), dock, theme toggle                                                                            |
| Views         | Overview, Transactions, Budgets, Recurring, Schedule, To-do, Vehicles, Categories, Piggies, Capitals, Calculator, Insights, Transparency                                                                           |
| Editors       | Transaction, event, wallet, category, subcategory, to-do list, vehicle, fuel/charge record, capital plan and item                                                                                                  |
| Confirmations | Generic delete, recurring scope, typed confirmation, discard changes, transfer and progress, calculator apply, backup restore, session revoke and local data clear                                                 |
| Account       | Authentication, identity creation, phrase reveal and quiz, passphrase, unlock, biometric offer, Terms gate, Preferences, Support, Navigation, Data & Privacy, Import & Export, recovery, What’s New, legal dialogs |
| Pickers       | Account, wallet, month/year, transaction filters, category, currency, timezone, reminder lead time, date, time, color, glyph and theme swatches                                                                    |
| Feedback      | Notices, offline and sync errors, loading, empty, success, disabled and validation states; tour overlays and chart tooltips                                                                                        |

For each row, check light and dark appearance, 390px, 768px, 1280px, and 1440px widths, keyboard focus, long content, popup clipping, nested overlays, and unchanged submission or dismissal behavior. Check the eight accents and four surfaces in both themes.

## Browser review, v6.4.0

Reviewed in headless Chrome against a local database, at 390, 768, 1280, and 1440px in the dark theme, and at 390 and 1280px in the light theme where noted. No horizontal page scroll at any width.

- **Views at all four widths:** Overview, Transactions, Budgets, Recurring, Schedule, To-do, Vehicles, Categories, Capitals, Calculator, Insights, Transparency, and Piggies.
- **Dialogs at 390px and 1280px:** Add Transaction, edit transaction, New Event, quick to-do, Open Custos index, delete confirmation with the armed button, typed confirmation, discard changes, vehicle, plan, to-do list, and category editors, Wallets, account menu, Navigation, Data & Privacy, Import & Export, Support, and the month picker.
- **Light theme:** hover fill, armed button, and notice.
- **Auth screens:** welcome, identity, and unlock at 390px and 1280px.
- **Public site:** home, Offers, and Services at 320, 390, 768, 1024, 1280, and 1440px, in light and dark.

Not yet reviewed: the eight accents and four surfaces beyond the default pair, guided-tour overlays, push and offline-banner states, the Terms gate, recovery reveal, legal dialogs, and the time, timezone, currency, and color pickers.
