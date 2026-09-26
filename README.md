# Custos

**[Website](https://nightfuryequinn.github.io/Custos/)** · **[Open the app](https://custos-kappa.vercel.app)**

Private expense ledger, schedule, and to-do app. Track spending across wallets and currencies, plan events with email/push reminders, and sign in with a Web3 wallet — no email or password required.

Built with **Bun**, **Hono**, **MongoDB**, and **React**.

![Custos](src/frontend/assets/logo.png)

## Features

### Ledger

- **Overview, transactions, budgets, insights, recurring** — monthly tracking with charts, category breakdowns, and budget progress (including **Reserved** amounts from schedule envelope holds); By Category leads the Overview page. Two-column card grids from 1280px up.
- **Piggies** — savings tracker per category ("piggy") and subcategory ("piglet"): lifetime balance (deposits minus withdrawals, excluding Capitals-assigned savings), an optional target/deadline with a progress ring, and a **Piggy Insights** engine (rate, streak, best month, pace-vs-deadline) on the Insights view — spanning Piggies and Capitals together, with a pace line per Capitals plan. Linked from Overview, Budgets, and Categories; exports to CSV.
- **Capitals** — planner for big expenses (marriage, trips, loans, or custom): a total budget, paid line items, assigned savings deposits, and a monthly-save hint from what's left to save divided by months to target. **Log** records a real payment against an item; deleting a plan returns its deposits to savings.
- **Subcategory breakdowns** — Overview's By Category and Transactions both drill into subcategories.
- **Calculator** — client-side budgeting: deduct custom tax lines from income, allocate the rest across categories (partial is fine), then apply to wallet budgets. Includes Malaysia-oriented presets (EPF/SOCSO/EIS/PCB/SST); nothing leaves the browser.
- **Multiple wallets** — 29 currencies; monthly-income or starting-balance funding.
- **Custom categories** — editable taxonomy with glyphs and colors; unused entries delete, in-use ones archive (so history keeps its type) and can transfer to another category.
- **Recurring transactions** — monthly/quarterly/yearly, auto-posted via cron-job.org; scoped delete (one occurrence, this-and-future, or the whole series) with confirmation.
- **Insights** — FX conversion, category trends and top subcategories, month-over-month charts with per-category breakdowns, a spending-habit profile (unlocks after 5 active days) with an Expense Profile header, an income profile, and Piggy Insights.
- **Vehicles** — fuel/charge logs per vehicle (car/EV/bike/van) with price, quantity, odometer, and station; EVs switch labels to kWh automatically. **Log** links a fill-up to a real transaction, and a Fuel Insights engine surfaces consumption trend, price timing, cost projection, and cadence once there's enough history.

### Schedule & tasks

- **Schedule** — calendar/agenda for bills and reminders with recurrence (daily to yearly) and multi-day events (`endDate`); Upcoming shows only the next occurrence of a series.
- **Budget holds** — optional encrypted envelope holds on any event (amount + category); reserve budget until you log payment or release the occurrence.
- **Log payment** — open a prefilled expense from an event and link `eventId` ↔ `expenseId`, releasing that occurrence's hold.
- **Email reminders** — optional Resend emails with per-event lead time and your timezone, plus a reminder at the event's own start; delivered to your account notify email.
- **Push notifications** — opt-in Web Push per device under **Account → Preferences**, on the same 15-minute poll as email.
- **TO-DO lists** — multiple named lists with inline task management.

### Identity & privacy

- **Web3 identity** — create or restore an in-browser wallet (12/24-word phrase); sign in with a SIWE-style challenge. A **ledger-only** key keeps the auth address uncorrelated with on-chain activity.
- **Device passphrase vault** — recovery-phrase quiz on create; keys wrapped locally with PBKDF2 + AES-GCM instead of plaintext `localStorage`.
- **Face ID / Touch ID unlock** — optional WebAuthn PRF biometric unlock per device; auto-prompts on open once enrolled, with the passphrase/button as fallback. An explicit sign-out turns auto-prompt off until next sign-in.
- **Theming** — system-aware dark mode meeting **WCAG 2.1 AA** contrast; 8 accent colors and 4 base surface palettes, both applied instantly and synced across devices via your profile.
- **Sessions & privacy** — HttpOnly cookies with sliding rotation, per-device revoke, local-data clear, and data-sharing consent under **Account → Data & privacy**.
- **Encrypted backup** — one pack covering ledger data and account/profile settings (notify email, timezone, theme, nav layout), encrypted with your ledger key, download/restore via **Account → Exports & imports**.
- **CSV export & import** — transactions, schedule events, and to-do lists.
- **Encrypted ledger** — amounts, names, categories, notes, titles, holds, and to-dos encrypted client-side; unlocked with your wallet key each session.
- **Offline unlock, reads & writes** — installable app shell + IndexedDB cache opens and unlocks with no connection; most edits queue already-encrypted and sync once back online. A locally-restored session with no server confirmation is trusted for 30 days.
- **Budget alerts** — email when a category nears/exceeds its monthly budget; the client evaluates and sends names/amounts, the server only delivers.
- **Transparency** — in-app map of hosting roles, what the server can infer, collections, and E2EE vs plaintext fields.
- **Guided tour** — Shepherd.js walkthrough per view; a first-sign-in modal offers guided or explore-alone, stored on your profile so it follows you across devices. Replay from the **?** beside any page title or **Account → Take a Tour**.
- **Mobile navigation** — at ≤860px the sidebar becomes a customizable tab bar (four views, More sheet for the rest) and the app opens on your first configured tab; desktop still opens on Overview.
- **What's New** — release notes open once per device per app version (see [Versioning](#versioning)); reachable anytime from **Account → What's New**.

### Security

- **End-to-end encryption** — transactions, wallet names/budgets, category trees, event titles/comments/holds, and to-do lists are AES-256-GCM encrypted client-side; the server stores ciphertext plus the plaintext schedule/email metadata reminders need.
- A recurring expense's `seriesKey` is HMAC-SHA256 under a key derived from your wallet signature — not a plain hash the server could dictionary-attack from fields it already has.
- Budget-alert emails only leave the browser when alerts are on and a notify email is set, checked client-side before sending.
- The sign-in challenge is validated against the exact SIWE message shape, blocking a malicious server from substituting the key-derivation message as a login prompt.
- Ownership uses opaque `accountId`; the SIWE address stays on `users` for login only. New document ids are random ObjectIds.
- Signature verification, Mongo-backed rate limiting (in-memory fallback), security headers (CSP allow-lists the inline boot script by hash), and a swept in-memory profile cache.
- Automated tests cover crypto/vault, encrypted backup, biometric selection, sign-in validation, reminder privacy, calculator, habit/income models, session auth, budget alerts, envelope holds, schedule math, push dedupe, pagination, cron cursors, header parity, insights, fuel insights, vehicle routes, and the release-notes gate (`bun test`).

## Tech stack

| Layer    | Stack                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------- |
| Runtime  | [Bun](https://bun.sh)                                                                                               |
| API      | [Hono](https://hono.dev) + Zod validation                                                                           |
| Database | [MongoDB](https://www.mongodb.com)                                                                                  |
| Frontend | React 19, TanStack Query, ethers v6                                                                                 |
| Styling  | Custom theme CSS (`ledger.css`, WCAG AA); Schibsted Grotesk / Azeret Mono self-hosted                               |
| Loading  | [ldrs](https://uiball.com/ldrs) trefoil spinner                                                                     |
| Motion   | [anime.js](https://animejs.com) v4                                                                                  |
| Tours    | [Shepherd.js](https://shepherdjs.dev)                                                                               |
| Diagrams | [Mermaid](https://mermaid.js.org) (Transparency view)                                                               |
| Deploy   | [Vercel](https://vercel.com) hosting + Analytics/Speed Insights only; cron via [cron-job.org](https://cron-job.org) |
| PWA      | `public/manifest.webmanifest` + `public/sw.js` (copied into `dist/` on build)                                       |
| Tooling  | TypeScript (`tsc --noEmit`) + [knip](https://knip.dev) (dead code detection)                                        |

## Project structure

```
api/index.ts              # Vercel serverless entry (re-exports bundled handler)
src/
├── index.ts              # Bun dev/prod server (API + SPA)
├── index.html
├── vercel-api.ts         # API bundle source (built → api/handler.js)
├── api/
│   ├── app.ts            # Hono app + error handler
│   ├── lib/              # auth, cache, email, push, reminders, reminder-details, pagination,
│   │                     # recurring-expenses, budget-alerts, expense-delete-scope,
│   │                     # expense-update, money, ids, serialize, errors
│   ├── middleware/       # session, rate-limit (Mongo + memory fallback), security, db
│   └── routes/           # auth, users, profile, wallets, categories,
│                         # expenses, events, todo-lists, capital-plans, vehicles,
│                         # consent, budget-alerts, push, fx, cron
├── db/                   # MongoDB client, collections, indexes, URI resolver
├── schemas/              # Zod schemas (shared API validation)
├── lib/                  # glyphs, recurring, schedule, timezone, budget-alerts, security-headers,
│                         # delete-scope, account-retention, version, accents, surfaces,
│                         # auth-message, legal, support-links (shared)
└── frontend/
    ├── app/              # Root, LedgerApp
    ├── auth/             # wallet sign-in, device vault, backups, account menu, session UI
    ├── assets/           # logo
    ├── charts/           # SVG charts (donut, trend, MoM bars)
    ├── components/       # Brand, ThemeToggle, Wallets, pickers, shared UI (incl. MobileBottomNav)
    ├── lib/
    │   ├── budget/         # in-tab budget-alert notifications
    │   ├── crypto/         # E2EE codec, key derivation, unlock flow
    │   ├── insights/       # shared ranked-card model (types, rank) used by Fuel Insights
    │   ├── push/           # Web Push permission + subscription lifecycle
    │   ├── pwa/            # service worker registration + IndexedDB cipher cache
    │   ├── sync/           # offline write queue (outbox, overlay, drain engine)
    │   ├── net/            # connectivity detection, ApiError, offline-failure classification
    │   ├── hooks/          # useLedger, useTheme
    │   ├── animate.ts      # anime.js motion hooks (modals, views, pickers)
    │   ├── tour/           # guided tour steps and runner
    │   ├── whats-new/      # release notes, per-device seen state, auto-show gate
    │   ├── fx.ts             # currency conversion for Insights
    │   ├── calculator.ts     # tax deduction + category allocation math
    │   ├── stats.ts          # shared transaction classification helpers
    │   ├── theme.ts          # light/dark preference + accent/surface color resolution
    │   ├── piggies.ts        # savings balance model (deposits − withdrawals, targets)
    │   ├── savingsInsights.ts # streaks, pace, projections for Piggies + Insights
    │   ├── fuelInsights.ts    # per-vehicle fuel/power metrics, vocabulary, ranked insights
    │   ├── capitals.ts        # capital plan totals, unpaid/budget remaining, monthly save, templates
    │   ├── capitalTemplates.ts # built-in Capitals templates (marriage, trip, car/house loan)
    │   └── envelope-holds.ts  # schedule ↔ budget hold math
    ├── styles/           # ledger.css (theme tokens + layout)
    ├── views/            # Calculator, Capitals, Categories, Piggies, Schedule, TodoList,
    │                     # Transparency, Vehicles, index.tsx (Overview, Transactions,
    │                     # Budgets, Recurring, Insights)
    └── main.tsx
public/                   # PWA manifest + service worker (copied into dist/ on build)
scripts/                  # MongoDB maintenance (account wipe, stale-user prune, index sync),
                          # marketing icon export (export-marketing-icons.ts)
tests/                    # auth, crypto, calculator, spending, income, schedule, budget/holds,
                          # pagination, cron scans, push routes, security headers, whats-new,
                          # insights, piggies, capitals, vehicles, sync, net, stats, seo, tour,
                          # categories, events, expenses, fx, and more
build.ts                  # Production build (dist/ + api/handler.js)
```

## Setup

```bash
bun install
```

Create a `.env` file in the project root (see `.env.example`):

| Variable                | Required   | Description                                                                                                                              |
| ----------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `MONGODB_URI`           | Yes        | MongoDB connection string                                                                                                                |
| `MONGODB_DB`            | No         | Database name (default: `ledger`)                                                                                                        |
| `APP_ORIGIN`            | Production | Public origin embedded in sign-in messages (required when `NODE_ENV=production` / on Vercel; otherwise falls back to the request origin) |
| `APP_TIMEZONE`          | No         | Server default IANA timezone for cron/reminders (fallback: `Asia/Kuala_Lumpur`)                                                          |
| `CRON_SECRET`           | For cron   | Bearer token for `GET /api/cron/reminders`                                                                                               |
| `RESEND_API_KEY`        | For email  | Resend API key for schedule reminders and budget alerts                                                                                  |
| `EMAIL_FROM`            | No         | Sender address (default: `Custos <onboarding@resend.dev>`)                                                                               |
| `VAPID_PUBLIC_KEY`      | For push   | Web Push application server key (generate with `npx web-push generate-vapid-keys`)                                                       |
| `VAPID_PRIVATE_KEY`     | For push   | Web Push private key — pairs with `VAPID_PUBLIC_KEY`                                                                                     |
| `VAPID_SUBJECT`         | For push   | Contact URL for the push services, e.g. `mailto:you@example.com`                                                                         |
| `EXCHANGE_RATE_API_KEY` | For FX     | [ExchangeRate-API](https://www.exchangerate-api.com) key for Insights currency conversion                                                |

### MongoDB

- **Local:** `MONGODB_URI=mongodb://127.0.0.1:27017` (start `mongod` first)
- **Atlas:** use your `mongodb+srv://…` string

On Windows, Bun may fail to resolve `mongodb+srv` DNS; the app auto-converts to a direct connection string at startup.

### Database scripts

```bash
bun run db:indexes       # sync indexes — run once against a fresh database
bun run db:prune-stale   # scripts/prune-stale-users.ts — see below for flags
bun run db:wipe-account -- --account-id <hex> --dry-run  # wipe one account's data
```

Connectivity check: `curl http://localhost:3000/` (expect `200`)

## Database schema

MongoDB database name defaults to `ledger` (`MONGODB_DB`). User-owned documents are keyed by opaque `accountId` (`users._id` hex). The SIWE wallet `address` lives on `users` (and `auth_nonces`) for login only. Every collection also has `_id` (`ObjectId`) and, where noted, `createdAt` / `updatedAt`.

Schemas are defined in `src/schemas/` and wired in `src/db/collections.ts`. Indexes are defined in `src/db/indexes.ts` and synced by `bun run db:indexes` (wired into the Vercel build command) rather than on every connect — a fresh local database needs it run once.

### Collections

| MongoDB collection    | Code key             | Purpose                                                                                                                                 |
| --------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `users`               | `users`              | Account profile (codename, notify email, timezone, reminder/alert prefs)                                                                |
| `ledger_profiles`     | `ledgerProfiles`     | Per-user UI state (`currentMonth`, `tourPreference`/`toursSeen`, theme/nav layout); `createdAt` is exposed to the client as account age |
| `financial_wallets`   | `financialWallets`   | Wallets (currency, funding mode; E2EE financials)                                                                                       |
| `category_taxonomies` | `categoryTaxonomies` | One document per user — E2EE category tree                                                                                              |
| `expenses`            | `expenses`           | Transactions (E2EE amount/sub/note; plaintext metadata)                                                                                 |
| `events`              | `events`             | Schedule events (E2EE title/comments/holds; plaintext schedule + email for reminders, plus `notifyDetails` while notify is on)          |
| `todo_lists`          | `todoLists`          | Named to-do lists (E2EE name/icon/tasks)                                                                                                |
| `capital_plans`       | `capitalPlans`       | Future-expense planners (E2EE name/template/budget/items)                                                                               |
| `vehicles`            | `vehicles`           | Tracked vehicles — car/EV/bike/van (E2EE name/model/plate/odometer/tank)                                                                |
| `vehicle_fills`       | `vehicleFills`       | Fuel fills or charges per vehicle (E2EE price/quantity/odometer/station)                                                                |
| `consent`             | `consent`            | Data-sharing opt-in flag                                                                                                                |
| `auth_nonces`         | `authNonces`         | Sign-in challenge nonces (TTL on `expiresAt`)                                                                                           |
| `sessions`            | `sessions`           | HttpOnly session tokens (hashed; TTL on `expiresAt`)                                                                                    |
| `reminder_logs`       | `reminderLogs`       | Dedupes sent schedule reminders per occurrence/channel; TTL on `sentAt` (~400 days)                                                     |
| `budget_alert_logs`   | `budgetAlertLogs`    | Dedupes budget-near-limit delivery; TTL on `sentAt` (~400 days)                                                                         |
| `push_subscriptions`  | `pushSubscriptions`  | Web Push endpoints, one row per browser (unique on `endpoint`) — the row _is_ the opt-in                                                |
| `rate_limits`         | `rateLimits`         | Shared API rate-limit buckets (`_id` = prefix + client key; TTL on `resetAt`; multi-instance)                                           |

### Encryption vs plaintext

| Collection            | Encrypted (client-side)                                                                  | Plaintext (needed for queries / cron)                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expenses`            | `payload` (amount, subcategory, note) via `enc`                                          | `accountId`, `date`, `kind`, `recurring`, `walletId`, `seriesKey` (HMAC under a wallet-derived key, not a plain hash of the other fields), `skipped`, optional `eventId`/`capitalPlanId` |
| `financial_wallets`   | `payload` (name, income, starting balance, budgets) via `enc`                            | `accountId`, `currency`, `fundingMode`, `isDefault`                                                                                                                                      |
| `category_taxonomies` | `payload` (full `categories[]` tree, incl. optional piggy `target`/`deadline`) via `enc` | `accountId`                                                                                                                                                                              |
| `events`              | `payload` (title, comments, customLabel/Glyph, budget hold fields) via `enc`             | `accountId`, `catId`, schedule fields, `notify`, `lead`, optional `expenseId`, and `notifyDetails` (title, hold, comments) only while `notify` is on                                     |
| `todo_lists`          | `payload` (name, icon, tasks) via `enc`                                                  | `accountId`                                                                                                                                                                              |
| `capital_plans`       | `payload` (name, templateId, glyph, targetDate, initialBudget, items) via `enc`          | `accountId`                                                                                                                                                                              |
| `vehicles`            | `payload` (name, model, plate, glyph, odometerStart, tankCapacity, notes) via `enc`      | `accountId`, `type`                                                                                                                                                                      |
| `vehicle_fills`       | `payload` (price, quantity, odometer, station) via `enc`                                 | `accountId`, `vehicleId`, `date`, `partial`, optional `expenseId`                                                                                                                        |
| `users`               | —                                                                                        | `address` (SIWE login), notify prefs                                                                                                                                                     |
| `push_subscriptions`  | —                                                                                        | `accountId`, `endpoint`, `p256dh`/`auth` keys — required verbatim to encrypt each push payload                                                                                           |
| `sessions`            | —                                                                                        | `accountId`, hashed token (rotated on renewal), `userAgent`, `ip` — used for the Active Sessions list and rate limiting                                                                  |
| `rate_limits`         | —                                                                                        | `_id` (limit key), `count`, `resetAt`                                                                                                                                                    |

Owned collections use opaque `accountId` (`users._id` hex).

Inactive accounts (no login/session activity for over 90 days) can be purged with their data:

```bash
bun scripts/prune-stale-users.ts --dry-run
bun scripts/prune-stale-users.ts --yes
```

The in-app **Transparency** view documents hosting roles, what the server can infer, and the same collections with example field shapes.

## Development

```bash
bun dev
bun test           # crypto, reminders, calculator, spending habits, income profile, session auth,
                    # budget alerts, envelope holds, schedule recurrence/multi-day, push dedupe,
                    # ranked insights, fuel insights, vehicle routes, release-notes gate
bun run typecheck  # tsc --noEmit
bun run knip       # unused files/exports/deps
```

Open [http://localhost:3000](http://localhost:3000). The SPA and API share the same origin (`/api/*`).

When `CRON_SECRET` is set in development, the server also polls every 15 minutes for due reminders and recurring expense rows. Email needs `RESEND_API_KEY`, push needs the `VAPID_*` keys — each channel is independent, and recurring materialization runs regardless.

### Liveness check

```bash
curl http://localhost:3000/
```

### Versioning

The user-facing version lives in [`src/lib/version.ts`](src/lib/version.ts) as `APP_VERSION`, mirrored by `"version"` in `package.json`. It shows under **Sign Out** in the account menu.

Release notes are a newest-first list in [`src/frontend/lib/whats-new/release-notes.ts`](src/frontend/lib/whats-new/release-notes.ts). Prepend an entry and bump `APP_VERSION` to re-announce: seen-state is stored per version in `localStorage`, so any device that hasn't seen the new version gets the modal on next load.

A version bump also needs three strings in [`website/index.html`](website/index.html) (`"softwareVersion"` in the JSON-LD, the `<span class="ver">` badge, and the footer line) — `tests/whats-new/release-notes.test.ts` enforces all stay in sync with `APP_VERSION`. `public/sw.js`'s cache-bust string is derived automatically by `build.ts` at build time.

New accounts get the notes too, after the welcome modal and any guided tour finish (welcome → tour → What's New), so they never overlap. To preview during development, delete `ledger:whatsnew:v1` in DevTools → Application → Local Storage and reload, or open **Account → What's New**.

## Authentication

Sign-in is wallet-based and verified on the server:

1. `POST /api/auth/challenge` — server issues a nonce and message to sign
2. Client signs with the wallet (ethers / browser wallet)
3. `POST /api/auth/verify` — server verifies the signature and sets an **HttpOnly** `ledger_session` cookie
4. Authenticated requests use `credentials: include` (no spoofable address header)

Manage sessions under **Account → Data & privacy** (revoke devices, sign out everywhere, clear cookies and local storage). Restore access on a new device with your **12- or 24-word recovery phrase**, then set a **device passphrase** so the key is encrypted on that browser. Re-signing in on a browser that lost its session cookie replaces that browser's prior session rather than duplicating it in Active Sessions (matched by User-Agent).

If Face ID / Touch ID is enrolled for the identity last used on a device, a lapsed session skips straight to that identity's unlock screen with the biometric prompt already firing. This is gated on `ledger:session` in local storage, which sign-out clears.

### Encryption

Ledger data (amounts, categories, notes, titles, holds, to-dos, wallet budgets/income) is encrypted in your browser with **AES-256-GCM**. The key is derived from a wallet signature over a fixed message — it never leaves your device and lives in memory for the session only.

In-app wallet secrets (mnemonic/private key) are wrapped with a **device passphrase** (PBKDF2 + AES-GCM) in `localStorage`, not stored plaintext. Injected browser wallets never store a key locally.

You may be prompted to **unlock** on each visit (device passphrase and/or wallet signature). MongoDB stores ciphertext plus the plaintext metadata queries/cron need — see [Encryption vs plaintext](#encryption-vs-plaintext). Prefer the honest framing **encrypted cloud sync**, not "data stays on your device."

## API overview

| Route                             | Description                                                                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/challenge`        | Start sign-in                                                                                                                                        |
| `POST /api/auth/verify`           | Complete sign-in                                                                                                                                     |
| `GET /api/auth/me`                | Current session                                                                                                                                      |
| `GET /api/auth/sessions`          | List active sessions                                                                                                                                 |
| `DELETE /api/auth/sessions/:id`   | Revoke a session                                                                                                                                     |
| `DELETE /api/auth/sessions`       | Revoke all other sessions                                                                                                                            |
| `POST /api/auth/logout`           | End current session                                                                                                                                  |
| `POST /api/auth/clear`            | Revoke all sessions and clear cookie                                                                                                                 |
| `GET/PATCH /api/users/me`         | Codename, notify email, timezone, reminder/alert prefs                                                                                               |
| `POST /api/users`                 | Create or upsert user profile on first sign-in                                                                                                       |
| `GET/PATCH /api/profile`          | Per-user UI state — month, tour progress, theme (accent/surface), nav layout; returns `id`/`createdAt` too                                           |
| `CRUD /api/wallets`               | Financial wallets (metadata + E2EE `enc`/`payload` via PATCH)                                                                                        |
| `PUT /api/wallets/:id/budgets`    | Update encrypted wallet financials (`enc`/`payload`)                                                                                                 |
| `GET/PUT /api/categories`         | Category taxonomy                                                                                                                                    |
| `CRUD /api/expenses`              | Transactions (scoped by wallet; cursor list via `limit`/`before`; optional series delete scopes)                                                     |
| `CRUD /api/events`                | Schedule events (comments + budget holds live in the E2EE payload; cursor list via `limit`/`before`)                                                 |
| `CRUD /api/todo-lists`            | TO-DO lists and tasks                                                                                                                                |
| `CRUD /api/capital-plans`         | Capitals planners and their line items                                                                                                               |
| `CRUD /api/vehicles`              | Tracked vehicles (car/EV/bike/van)                                                                                                                   |
| `CRUD /api/vehicles/fills`        | Fuel fills or charges (cursor list via `limit`/`before`, filterable by `vehicleId`)                                                                  |
| `GET/PATCH /api/consent`          | Data-sharing consent                                                                                                                                 |
| `POST /api/budget-alerts`         | Deliver client-evaluated budget alerts (email; deduped)                                                                                              |
| `GET /api/fx/latest/:base`        | Cached FX rates (requires `EXCHANGE_RATE_API_KEY`)                                                                                                   |
| `GET /api/push/public-key`        | VAPID application server key for browser subscription                                                                                                |
| `POST/DELETE /api/push/subscribe` | Register or remove this device's Web Push endpoint                                                                                                   |
| `GET /api/cron/reminders`         | Auth: `Authorization: Bearer $CRON_SECRET`. Sends due reminders (email + push) and materializes recurring expenses                                   |
| `POST /api/cron/notify-release`   | Auth: `Authorization: Bearer $CRON_SECRET`. Body `{ "version": "3.0.0" }`. Broadcasts an "app updated" push — called by CI after a successful deploy |

All mutating routes require a valid session cookie. Auth endpoints have stricter rate limits.

## Production (self-hosted)

```bash
bun run build   # static frontend → dist/; API bundle → api/handler.js
NODE_ENV=production bun src/index.ts
```

Set `NODE_ENV=production` so session cookies are marked `Secure` over HTTPS. For Vercel, deploy the build output instead — see below.

## Deploy on Vercel

The API is bundled into `api/handler.js` during `bun run build` so Vercel can resolve TypeScript path aliases at runtime. Scheduled tasks (reminder emails and recurring expenses) are triggered by an external cron job — see [Scheduled tasks (cron-job.org)](#scheduled-tasks-cron-joborg) below.

### Environment variables

Set these in **Vercel → Project → Settings → Environment Variables** for Production and Preview:

| Variable                                                   | Description                                                                                        |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `MONGODB_URI`                                              | Atlas `mongodb+srv://…` connection string                                                          |
| `MONGODB_DB`                                               | Database name (default: `ledger`)                                                                  |
| `APP_ORIGIN`                                               | **Required** public app URL, e.g. `https://your-project.vercel.app` (embedded in sign-in messages) |
| `APP_TIMEZONE`                                             | Optional — server default IANA timezone for cron/reminders (fallback: `Asia/Kuala_Lumpur`)         |
| `NODE_ENV`                                                 | `production` (Vercel usually sets this; enables `Secure` session cookies)                          |
| `CRON_SECRET`                                              | Secret for the cron handler (used by cron-job.org)                                                 |
| `RESEND_API_KEY`                                           | Optional — enable schedule reminder emails and budget-alert emails                                 |
| `EMAIL_FROM`                                               | Optional — verified sender in Resend                                                               |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Optional — enable Web Push reminders alongside email                                               |
| `EXCHANGE_RATE_API_KEY`                                    | Optional — enable FX conversion in Insights                                                        |

**Atlas network access:** allow `0.0.0.0/0` so Vercel's dynamic egress IPs can reach your cluster.

### Deploy

1. Push the repo to GitHub.
2. Import the project at [vercel.com/new](https://vercel.com/new).
3. Framework preset: **Other** (build/output are defined in [`vercel.json`](vercel.json)).
4. Add the environment variables above.
5. Deploy.

CLI alternative:

```bash
bunx vercel login
bunx vercel          # preview deployment
bunx vercel --prod   # production
```

Optional: run `bunx vercel dev` locally to test Vercel routing before deploying.

### Scheduled tasks (cron-job.org)

Vercel is used for **hosting and Analytics/Speed Insights only** — it does not schedule jobs. Reminders and recurring expenses are triggered solely by [cron-job.org](https://cron-job.org) calling the hosted API.

The reminder handler polls on each run and delivers when the current time falls in an event's window: **remind-at − 15 min ≤ now ≤ remind-at + 15 min**. Set the external job to run **every 15 minutes**. Each poll is batched (document limits + ~22s budget) to stay under the ~30s cron-job.org/Vercel timeout.

1. Create a free account at [cron-job.org](https://console.cron-job.org/signup).
2. **Create cronjob** with:
   - **Title:** e.g. `Custos reminders`
   - **URL:** `https://<your-app>.vercel.app/api/cron/reminders`
   - **Schedule:** every **15 minutes** (cron expression `*/15 * * * *`)
   - **Request method:** `GET`
   - **Request headers:** add `Authorization` with value `Bearer <CRON_SECRET>` (same secret as in Vercel env vars)
3. Save and enable the job.

Manual test:

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  "https://<your-app>.vercel.app/api/cron/reminders"
```

Expect `{ "ok": true, "reminders": { ... }, "recurring": { ... } }`.

### Release-update push (CI, not cron-job.org)

`.github/workflows/notify-release.yml` listens for GitHub's `deployment_status` event (posted automatically by Vercel's GitHub integration) and, on a successful **Production** deploy, calls `POST /api/cron/notify-release` with the version from `package.json`, broadcasting an "app updated" push to every subscribed device (needs the `VAPID_*` keys; no-ops silently if unset).

Add the same `CRON_SECRET` as a **GitHub Actions repository secret** and set `environment: Production` on the job (already set) so it can read a `CRON_SECRET` scoped to that environment.

`github.event.deployment_status.target_url` is Vercel's per-deployment URL, not the production alias — if Vercel Authentication (Deployment Protection) is enabled it 401s before reaching the app. Generate a **Protection Bypass for Automation** token under Vercel Project Settings and add it as `VERCEL_AUTOMATION_BYPASS_SECRET` so the workflow's `x-vercel-protection-bypass` header can get past it.

Manual test:

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" \
  -d '{"version":"3.0.0"}' \
  "https://<your-app>.vercel.app/api/cron/notify-release"
```

### Verify after deploy

1. **Liveness check** — `GET https://<your-app>.vercel.app/` should return `200` and serve the app shell.
2. **Sign-in** — open the app, create or restore a wallet, complete the sign-in challenge, and confirm you land in the main UI.
3. **CRUD** — add an expense and a schedule event; refresh and confirm data persists.
4. **Wallets** — create a second wallet, switch between them, confirm transactions stay scoped.
5. **Sessions** — open **Account → Data & privacy**, confirm your device is listed, and test revoke/sign out.
6. **Exports** — download an encrypted backup and/or CSV from **Account → Exports & imports**, then re-import.
7. **Transparency** — confirm hosting, inference, and collection maps render.
8. **Log payment** — create a bill event, use **Log payment**, confirm the expense links back to it.
9. **Budget hold** — enable a hold, confirm Budgets shows **Held**, log payment, confirm release.
10. **Push notifications** — enable under **Account → Preferences**, confirm the device registers (needs `VAPID_*`; on iOS, add to Home Screen first).
11. **What's New** — confirm notes open on a device that hasn't seen this version, and reopen via **Account → What's New**.
12. **First-run tour prompt** — sign in with a fresh wallet, confirm the welcome modal shows once; test both **I'll explore** and **Show me around** paths, and that the choice persists across reload.
13. **Face ID auto-unlock** — with Face ID enrolled, clear the session cookie (keep local storage) and reload: it should jump to unlock with the OS prompt open. Sign out explicitly and confirm the welcome screen returns with no auto-prompt.
14. **Session dedup** — sign in, clear that browser's `ledger_session` cookie, sign in again, and confirm **Active Sessions** still shows one entry.

### Serverless notes

- Rate limiting uses the shared Mongo `rate_limits` collection across function instances (in-memory fallback if the DB is unavailable). Profile cache and FX cache remain in-memory per instance.
- Cold starts may add latency on the first request while MongoDB connects; warm instances reuse the cached client.

## Support Custos

The official hosted app is free with full features, and always will be — nothing below gates the ledger, encryption, exports, or backups. Theming (accent + base colors) is free for every account. **Account → Support Custos** links to:

- **Tips** — Ko-fi or GitHub Sponsors, one-off or recurring.
- Disclosed, non-personalized affiliate offers and B2B services on the [website](https://nightfuryequinn.github.io/Custos/offers.html) — never inside the app, never near ledger content.

## License

Custos is proprietary ([LICENSE](LICENSE)). The repository is public for **transparency and evaluation**.

- **Free to use** on the Licensor's official hosted app (full features), under the in-app Terms. Custos does not share your data with anyone — the "data sharing" toggle under Data & privacy only records a preference for a possible future opt-in programme that does not exist yet.
- **Not free to self-host, rebrand, claim as your product, or offer as a competing service.** Those uses need a written commercial agreement (monthly fee, collaboration, or copyright buyout) — see [Commercial and self-hosting](https://nightfuryequinn.github.io/Custos/services.html) for fixed-price options.
- Contact: [xianzyip8@gmail.com](mailto:xianzyip8@gmail.com)
