# Custos redesign coverage

The visual rules in `website/site.css` and `src/frontend/styles/ledger.css` apply across the surfaces below. The desktop and phone browser review remains open because no browser was available in this workspace.

| Area          | Surfaces to inspect in browser                                                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Promotional   | Home hero, features, schedule, goals, privacy, stats, FAQ, stack, final CTA, footer; Offers; Services                                                                                                              |
| Shell         | Sidebar, topbar, account menu, wallet and month controls, quick action, mobile tabs, More sheet, theme toggle                                                                                                      |
| Views         | Overview, Transactions, Budgets, Recurring, Schedule, To-do, Vehicles, Categories, Piggies, Capitals, Calculator, Insights, Transparency                                                                           |
| Editors       | Transaction, event, wallet, category, subcategory, to-do list, vehicle, fuel/charge record, capital plan and item                                                                                                  |
| Confirmations | Generic delete, recurring scope, transfer and progress, calculator apply, wallet/category/vehicle/capital deletion, session revoke and local data clear                                                            |
| Account       | Authentication, identity creation, phrase reveal and quiz, passphrase, unlock, biometric offer, Terms gate, Preferences, Support, Navigation, Data & Privacy, Import & Export, recovery, What’s New, legal dialogs |
| Pickers       | Account, wallet, month/year, transaction filters, category, currency, timezone, reminder lead time, date, time, color, glyph and theme swatches                                                                    |
| Feedback      | Offline and sync errors, loading, empty, success, disabled and validation states; tour overlays and chart tooltips                                                                                                 |

For each row, check light and dark appearance, 390px and 1440px widths, keyboard focus, long content, popup clipping, nested overlays, and unchanged submission or dismissal behavior. Check the eight accents and four surfaces in both themes. Record screenshots and any remaining issues when a browser is available.
