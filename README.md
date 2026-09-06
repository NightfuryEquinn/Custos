# Custos

**[Website](https://nightfuryequinn.github.io/Custos/)** · **[Open the app](https://custos-kappa.vercel.app)**

Private expense ledger, schedule, and to-do app. Track spending across multiple wallets and currencies, plan events with email and push reminders, and sign in with a Web3 wallet — no email or password required.

Built with **Bun**, **Hono**, **MongoDB**, and **React**.

![Custos](src/frontend/assets/logo.png)

## Features

### Ledger

- **Overview, transactions, budgets, insights, recurring** — monthly expense tracking with charts, category breakdowns, and budget progress (including **Held** amounts reserved by schedule envelope holds); from 1280px up, Transactions and Budget by Category use two-column card grids for denser reading
- **Piggies** — one-glance tracker for every savings category ("piggy") and its subcategories ("piglets"): lifetime balance derived from deposits minus withdrawals (excluding savings assigned to a Capitals plan), an optional target and deadline with a progress ring, and a **Saving Insights** engine (savings rate, streak, best month, pace-vs-deadline projections) surfaced on the Insights view. Saving Insights spans **Piggies and Capitals together**: assigned deposits count toward the wallet-wide rate, net, streak, and best month (split out as piggies vs capitals) and every plan gets a pace line — set aside, left to save, monthly pace, and funded / on pace / behind / overpaid — while per-piggy pace stays capital-free. The Piggies view keeps the totals row and each card's on-track status. Linked from Overview, Budgets, and Categories; exports to its own CSV
- **Capitals** — planner for big future expenses (marriage, trips, car/house loans, or a custom plan): start from a template or blank, set a **total budget** (or let it fall back to the sum of your item estimates), check off line items as paid, and assign savings deposits to the plan to build up its pot. **Saved** is everything you have put in, **Unspent** is what is left of it once paid items have drawn it down, and **still to save** is the unpaid budget less that remaining pot — divided by the months until your target, that is the **monthly save** hint (or **Overpaid** when paid exceeds budget). Summaries roll the same figures up across plans, **Log** records a real payment straight into a prefilled expense that links back to the item, and deleting a plan returns its assigned deposits to their savings envelopes rather than stranding them. Capitals and Vehicles cards stay one column until 1280px, then open to two columns
- **Subcategory breakdowns** — Overview's By Category card and Transactions both expand a category into its subcategories (Transactions uses a responsive card grid when a category filter is active)
- **Calculator** — client-side budgeting helper with a side-by-side Income / Tax Collection setup on wider screens, a live allocation progress bar, and responsive category cards: deduct custom tax lines from income, allocate net by category percent or amount, then apply to wallet budgets with confirmation; includes Malaysia-oriented presets (EPF / SOCSO / EIS / PCB ballpark / SST) that never leave the browser
- **Multiple wallets** — create wallets in 29 currencies; monthly-income or starting-balance funding modes
- **Custom categories** — editable expense, savings, and income category/subcategory taxonomy with glyphs and colors; unused categories and subcategories (built-in or custom) can be deleted, in-use ones are archived so history keeps its type, and archived items can be transferred onto another category; at 1280px and wider, Your Taxonomy and Budget by Category use two-column card grids
- **Recurring transactions** — monthly, quarterly, or yearly; auto-posted on due dates via cron-job.org; delete scopes for one occurrence, this-and-future, or the whole series; destructive deletes ask for confirmation first
- **Insights** — FX conversion, a ranked **What Stands Out** feed (month-end spend forecast with a confidence band, over-budget categories before the month ends, unusually large charges, category spend drift, and new/stopped/creeping recurring charges), month-over-month charts (daily/monthly/quarterly/yearly), an earnings line plotted against spending on the overview trend, per-category hover breakdowns on charts and recent rows, and spending habits (unlock after five active transaction days)
- **Vehicles** — track fuel or charging costs per vehicle (car, EV, bike, or van): log fill-ups or charges with price, quantity, odometer, and station, with an optional partial-fill flag and **Log** to link one to a real ledger transaction. An EV automatically switches every label to kWh, charge, and kWh/100km instead of litres and fill-ups. A **Fuel Insights** engine (same ranked-card model as Transaction Insights) surfaces consumption trend, price timing, running-cost projection, and cadence once a vehicle has logged enough history

### Schedule & tasks

- **Schedule** — calendar and agenda for bills, appointments, and reminders with recurrence (daily/weekly/biweekly/monthly/yearly); events can span multiple days via `endDate`, and Upcoming shows only the next occurrence of a recurring series; from 1280px up, Upcoming / Agenda day groups lay out as a two-column card grid
- **Budget holds** — optional encrypted envelope holds on any schedule event (amount + category); active holds reserve budget until you log payment or release the occurrence; amounts never leave the E2EE payload
- **Log payment** — from a bill/renewal event, open a prefilled expense and link `eventId` ↔ `expenseId` (plaintext metadata only); also releases that occurrence's budget hold when present
- **Email reminders** — optional Resend emails with per-event lead times and user timezone; delivery goes to your **account notify email** (set under Data & privacy). Every notifying event also always gets a reminder right at its own start (the clock time, or 9:00 AM on the day for all-day events) on top of the chosen lead, deduped when the lead already is "at the time of the event"; confirmation when you enable notify; the reminder includes the event name, budget hold and comments, so turning notify on stores a readable copy (`notifyDetails`) that renders both the email and the push notification — switching it off deletes that copy and events without reminders stay fully encrypted
- **Push notifications** — opt-in Web Push per device under **Account → Preferences**, delivered on the same 15-minute poll as the reminder emails and carrying the same event name, time, hold and comments; each browser subscribes separately, and turning it off on one device leaves the others and your emails untouched
- **TO-DO lists** — multiple named lists with inline task management

### Identity & privacy

- **Web3 identity** — create or restore an in-browser wallet (12- or 24-word recovery phrase); sign in with a cryptographic challenge (SIWE-style). Prefer a **ledger-only** key so the auth address is not correlated with on-chain activity
- **Device passphrase vault** — recovery phrase quiz on create; in-app keys wrapped with a local passphrase (PBKDF2 + AES-GCM) instead of plaintext `localStorage`
- **Face ID / Touch ID unlock** — optional per-device biometric unlock via WebAuthn PRF; the passphrase is encrypted with a key derived from the biometric assertion and never stored in the clear. Offered once after your first passphrase unlock, or toggle anytime under **Account → Preferences**
- **Dark mode** — system-aware theme toggle, persisted locally; dark palette targets **WCAG 2.1 AA** contrast (≥ 4.5:1 normal text, ≥ 3.0:1 large text / UI chrome) with brighter secondary ink (`--ink-faint`), clearer card borders, high-contrast filled controls (`--accent-contrast`), and vivid status / progress fills
- **Typography** — Young Serif (display), Schibsted Grotesk (UI), and Azeret Mono (amounts), self-hosted SIL OFL faces in `src/frontend/styles/fonts.css` and shared with the marketing site; summary amounts stay 20–24px and reflow on narrow screens so long figures do not overflow
- **Sessions & privacy** — HttpOnly session cookies with sliding token rotation, revoke devices, clear local data, and third-party data-sharing consent under **Account → Data & privacy**
- **Encrypted backup** — download/restore an encrypted ledger pack (wallets, categories, transactions, schedule, todos, Capitals plans, and Vehicles) encrypted with your ledger key (client-only; not stored on the server) via **Account → Exports & imports**
- **CSV export & import** — transactions (with categories), schedule events, and to-do lists (plaintext spreadsheet portability)
- **Encrypted ledger** — amounts, wallet names, categories, notes, schedule titles, budget holds, and to-dos encrypted client-side; unlock with your wallet key each session
- **PWA read cache** — installable app shell + IndexedDB ciphertext cache for offline reads (writes still require the network)
- **Budget alerts** — email when a category nears or exceeds its monthly budget (E2EE-safe: client evaluates and sends names/amounts; server only delivers)
- **Transparency** — in-app map of hosting roles, what the server can infer, MongoDB collections, E2EE vs plaintext fields, and data relationships (Mermaid diagrams rendered top-to-bottom for readability)
- **Guided tour** — Shepherd.js walkthrough for each main view. On first sign-in a welcome modal asks whether to take the guided tour or explore alone; the answer is stored on the ledger profile (`tourPreference`), so it follows the user across devices rather than living in this browser's `localStorage`. Dismissing a tour counts as having seen it. Replay any view's tour from the **?** beside the page title, or **Account → Take a Tour**
- **Mobile navigation** — at ≤860px the sidebar becomes a five-tab bar (Overview, Schedule, Transactions, To-Do, More) with a bottom sheet for the remaining views; the tab bar stays fixed while content scrolls
- **What's New** — release notes open once per device per app version (see [Versioning](#versioning)), and stay reachable from **Account → What's New**

### Security

- **End-to-end encryption** — ledger content (transactions, wallet names/budgets, category trees, event titles/comments/budget holds, and to-do lists) is AES-256-GCM encrypted in the browser before reaching MongoDB; the server only stores ciphertext (plus plaintext schedule/email metadata needed for accurate reminder cron — day-level dates are intentional, and events with reminders on also keep a readable copy of the name/hold/comments that both the email and the push notification render)
- Ownership uses opaque `accountId` (`users._id`); the SIWE address stays on `users` for login only
- New document ids are random ObjectIds (no embedded creation timestamp)
- Signature verification, Mongo-backed rate limiting (in-memory fallback), security headers, in-memory profile cache
- Automated tests for crypto unlock/codec, device vault, encrypted backup, reminder email privacy, calculator, spending habits, session auth, budget-alert evaluation, envelope holds, multi-day and recurring schedule math, push dedupe, compound list pagination, cron scan cursors, security-header parity, the ranked-insight model, transaction and fuel insights, vehicle routes, and the release-notes gate (`bun test`)

## Tech stack

| Layer    | Stack                                                                                                                                                       |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime  | [Bun](https://bun.sh)                                                                                                                                       |
| API      | [Hono](https://hono.dev) + Zod validation                                                                                                                   |
| Database | [MongoDB](https://www.mongodb.com)                                                                                                                          |
| Frontend | React 19, TanStack Query, ethers v6                                                                                                                         |
| Styling  | Custom theme CSS (`ledger.css`) with WCAG AA dark-mode contrast tokens; Young Serif / Schibsted Grotesk / Azeret Mono self-hosted via `fonts.css` (SIL OFL) |
| Loading  | [ldrs](https://uiball.com/ldrs) trefoil spinner                                                                                                             |
| Motion   | [anime.js](https://animejs.com) v4                                                                                                                          |
| Tours    | [Shepherd.js](https://shepherdjs.dev)                                                                                                                       |
| Diagrams | [Mermaid](https://mermaid.js.org) (Transparency view)                                                                                                       |
| Deploy   | [Vercel](https://vercel.com) **hosting + Analytics / Speed Insights only** (no Vercel Cron); scheduled jobs via [cron-job.org](https://cron-job.org)        |
| PWA      | `public/manifest.webmanifest` + `public/sw.js` (copied into `dist/` on build)                                                                               |
| Tooling  | TypeScript (`tsc --noEmit`) + [knip](https://knip.dev) (dead code detection)                                                                                |

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
│                         # delete-scope, account-retention, version (shared)
└── frontend/
    ├── app/              # Root, LedgerApp
    ├── auth/             # wallet sign-in, device vault, backups, account menu, session UI
    ├── assets/           # logo
    ├── charts/           # SVG charts (donut, trend, MoM bars)
    ├── components/       # Brand, ThemeToggle, Wallets, MobileBottomNav, pickers, shared UI
    ├── lib/
    │   ├── budget/         # in-tab budget-alert notifications
    │   ├── crypto/         # E2EE codec, key derivation, unlock flow
    │   ├── insights/       # shared ranked-card model (types, rank, txInsights)
    │   ├── push/           # Web Push permission + subscription lifecycle
    │   ├── pwa/            # service worker registration + IndexedDB cipher cache
    │   ├── hooks/          # useLedger, useTheme
    │   ├── animate.ts      # anime.js motion hooks (modals, views, pickers)
    │   ├── tour/           # guided tour steps and runner
    │   ├── whats-new/      # release notes, per-device seen state, auto-show gate
    │   ├── piggies.ts        # savings balance model (deposits − withdrawals, targets)
    │   ├── savingsInsights.ts # streaks, pace, projections for Piggies + Insights
    │   ├── fuelInsights.ts    # per-vehicle fuel/power metrics, vocabulary, ranked insights
    │   ├── capitals.ts        # capital plan totals, unpaid/budget remaining, monthly save, templates
    │   ├── capitalTemplates.ts # built-in Capitals templates (marriage, trip, car/house loan)
    │   └── envelope-holds.ts  # schedule ↔ budget hold math
    ├── styles/           # ledger.css (theme tokens + layout)
    ├── views/            # Overview, Transactions, Budgets, Calculator, Categories,
    │                     # Recurring, Insights, Piggies, Capitals, Vehicles, Schedule, TodoList, Transparency
    └── main.tsx
public/                   # PWA manifest + service worker (copied into dist/ on build)
scripts/                  # MongoDB maintenance (drop/list, stale-user prune, reminder_log backfill)
tests/                    # auth, crypto, calculator, spending, schedule, budget/holds, pagination,
                          # cron scans, push routes, security headers, whats-new, insights, vehicles
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
bun run db:list          # list collections
bun run db:drop expenses events --yes   # drop specific collection(s)
bun run db:drop:all --yes  # drop all app collections
```

Connectivity check: `curl http://localhost:3000/` (expect `200`)

## Database schema

MongoDB database name defaults to `ledger` (`MONGODB_DB`). User-owned documents are keyed by opaque `accountId` (`users._id` hex). The SIWE wallet `address` lives on `users` (and `auth_nonces`) for login only. Every collection also has `_id` (`ObjectId`) and, where noted, `createdAt` / `updatedAt`.

Schemas are defined in `src/schemas/` and wired in `src/db/collections.ts`. Indexes are created on connect via `src/db/indexes.ts`.

### Collections

| MongoDB collection    | Code key             | Purpose                                                                                                                                                        |
| --------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`               | `users`              | Account profile (codename, notify email, timezone, reminder/alert prefs)                                                                                       |
| `ledger_profiles`     | `ledgerProfiles`     | Per-user UI state (`currentMonth`, plus `tourPreference` / `toursSeen` for guided-tour onboarding); its `createdAt` is exposed to the client as account age    |
| `financial_wallets`   | `financialWallets`   | Wallets (currency, funding mode; E2EE financials)                                                                                                              |
| `category_taxonomies` | `categoryTaxonomies` | One document per user — E2EE category tree                                                                                                                     |
| `expenses`            | `expenses`           | Transactions (E2EE amount/sub/note; plaintext metadata)                                                                                                        |
| `events`              | `events`             | Schedule events (E2EE title/comments/holds; plaintext schedule + email for reminders, plus `notifyDetails` while notify is on)                                 |
| `todo_lists`          | `todoLists`          | Named to-do lists (E2EE name/icon/tasks)                                                                                                                       |
| `capital_plans`       | `capitalPlans`       | Future-expense planners (E2EE name/template/budget/items)                                                                                                      |
| `vehicles`            | `vehicles`           | Tracked vehicles — car/EV/bike/van (E2EE name/model/plate/odometer/tank)                                                                                       |
| `vehicle_fills`       | `vehicleFills`       | Fuel fills or charges per vehicle (E2EE price/quantity/odometer/station)                                                                                       |
| `consent`             | `consent`            | Data-sharing opt-in flag                                                                                                                                       |
| `auth_nonces`         | `authNonces`         | Sign-in challenge nonces (TTL on `expiresAt`)                                                                                                                  |
| `sessions`            | `sessions`           | HttpOnly session tokens (hashed; TTL on `expiresAt`)                                                                                                           |
| `reminder_logs`       | `reminderLogs`       | Dedupes sent schedule reminders, per occurrence and per `channels` (email / push; absent on pre-push rows, which were email-only); TTL on `sentAt` (~400 days) |
| `budget_alert_logs`   | `budgetAlertLogs`    | Dedupes budget-near-limit email/push delivery; TTL on `sentAt` (~400 days)                                                                                     |
| `push_subscriptions`  | `pushSubscriptions`  | Web Push endpoints, one row per browser (unique on `endpoint`) — the row _is_ the opt-in                                                                       |
| `rate_limits`         | `rateLimits`         | Shared API rate-limit buckets (`_id` = prefix + client key; TTL on `resetAt`; multi-instance)                                                                  |

### Encryption vs plaintext

| Collection            | Encrypted (client-side)                                                                                       | Plaintext (needed for queries / cron)                                                                                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `expenses`            | `payload` (amount, subcategory, note) via `enc`                                                               | `accountId`, `date`, `kind`, `recurring`, `walletId`, `seriesKey`, `skipped`, optional `eventId`, optional `capitalPlanId`                                                                                                                                               |
| `financial_wallets`   | `payload` (name, income, starting balance, budgets) via `enc`                                                 | `accountId`, `currency`, `fundingMode`, `isDefault`                                                                                                                                                                                                                      |
| `category_taxonomies` | `payload` (full `categories[]` tree, incl. optional piggy `target`/`deadline` per category and sub) via `enc` | `accountId`                                                                                                                                                                                                                                                              |
| `events`              | `payload` (title, comments, customLabel/Glyph, budget hold fields) via `enc`                                  | `accountId`, `catId`, schedule fields (`exceptDates`, `until`, …), `notify`, `lead`, optional `expenseId`, and `notifyDetails` (title, hold, comments) only while `notify` is on — legacy per-event `email` may remain on old rows but delivery uses `users.notifyEmail` |
| `todo_lists`          | `payload` (name, icon, tasks) via `enc`                                                                       | `accountId`                                                                                                                                                                                                                                                              |
| `capital_plans`       | `payload` (name, templateId, glyph, targetDate, initialBudget, items) via `enc`                               | `accountId`                                                                                                                                                                                                                                                              |
| `vehicles`            | `payload` (name, model, plate, glyph, odometerStart, tankCapacity, notes) via `enc`                           | `accountId`, `type`                                                                                                                                                                                                                                                      |
| `vehicle_fills`       | `payload` (price, quantity, odometer, station) via `enc`                                                      | `accountId`, `vehicleId`, `date`, `partial`, optional `expenseId`                                                                                                                                                                                                        |
| `users`               | —                                                                                                             | `address` (SIWE login), notify prefs                                                                                                                                                                                                                                     |
| `push_subscriptions`  | —                                                                                                             | `accountId`, `endpoint`, and the browser's `p256dh` / `auth` keys — required verbatim to encrypt each push payload                                                                                                                                                       |
| `sessions`            | —                                                                                                             | `accountId`, hashed token (rotated on sliding renewal)                                                                                                                                                                                                                   |
| `rate_limits`         | —                                                                                                             | `_id` (limit key), `count`, `resetAt`                                                                                                                                                                                                                                    |

Owned collections use opaque `accountId` (`users._id` hex).

Inactive accounts (no login / session activity for over 90 days) can be purged with their data:

```bash
bun scripts/prune-stale-users.ts --dry-run
bun scripts/prune-stale-users.ts --yes
```

The in-app **Transparency** view documents hosting roles, what the server can infer, and the same collections with example field shapes.

## Development

```bash
bun dev
bun test        # crypto, reminders, calculator, spending habits, session auth, budget alerts,
                # envelope holds, schedule recurrence/multi-day, push dedupe, ranked insights,
                # transaction/fuel insights, vehicle routes, release-notes gate
bun run typecheck  # tsc --noEmit
bun run knip       # unused files/exports/deps
```

Open [http://localhost:3000](http://localhost:3000). The SPA and API share the same origin (`/api/*`).

When `CRON_SECRET` is set in development, the server also polls every 15 minutes for due reminders and recurring expense rows. Email delivery needs `RESEND_API_KEY` and Web Push delivery needs the `VAPID_*` keys — each channel is independent, and recurring expense materialization runs regardless.

### Liveness check

```bash
curl http://localhost:3000/
```

### Versioning

The user-facing version lives in [`src/lib/version.ts`](src/lib/version.ts) as `APP_VERSION`, mirrored by `"version"` in `package.json`. It is shown under **Sign Out** in the account menu.

Release notes are a newest-first list in [`src/frontend/lib/whats-new/release-notes.ts`](src/frontend/lib/whats-new/release-notes.ts). Prepend a new entry and bump `APP_VERSION` to re-announce: the modal opens on the next load of every device that has not seen that version, because seen-state is stored per version in `localStorage` under `ledger:whatsnew:v1`. The modal scrolls the full changelog; **Got It** stays fixed at the bottom.

The only quiet case is a device that already saw the current version. New accounts get the notes too — after the welcome modal and any guided tour finish, so the three never overlap: welcome modal → tour (if chosen) → What's New.

To preview it during development, delete `ledger:whatsnew:v1` in DevTools → Application → Local Storage and reload, or open **Account → What's New**.

## Authentication

Sign-in is wallet-based and verified on the server:

1. `POST /api/auth/challenge` — server issues a nonce and message to sign
2. Client signs with the wallet (ethers / browser wallet)
3. `POST /api/auth/verify` — server verifies the signature and sets an **HttpOnly** `ledger_session` cookie
4. Authenticated requests use `credentials: include` (no spoofable address header)

Manage sessions under **Account → Data & privacy** (revoke devices, sign out everywhere, clear cookies and local storage). Restore access on a new device with your **12- or 24-word recovery phrase**, then set a **device passphrase** so the key is encrypted on that browser.

### Encryption

Ledger data (transaction amounts, categories, notes, schedule titles, budget holds, to-do lists, and per-wallet budgets/income) is encrypted in your browser with **AES-256-GCM**. The encryption key is derived from a wallet signature over a fixed message — it never leaves your device and is held in memory for the session only.

In-app wallet secrets (mnemonic / private key) are wrapped with a **device passphrase** (PBKDF2 + AES-GCM) in `localStorage` — not stored as plaintext. Injected browser wallets never store a private key locally.

On each visit you may be prompted to **unlock** your ledger (device passphrase and/or a wallet signature). MongoDB stores ciphertext plus plaintext metadata needed for queries and cron — see [Encryption vs plaintext](#encryption-vs-plaintext). Prefer the honest framing **encrypted cloud sync**, not “data stays on your device.”

## API overview

| Route                             | Description                                                                                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/auth/challenge`        | Start sign-in                                                                                                                                                                                                      |
| `POST /api/auth/verify`           | Complete sign-in                                                                                                                                                                                                   |
| `GET /api/auth/me`                | Current session                                                                                                                                                                                                    |
| `GET /api/auth/sessions`          | List active sessions                                                                                                                                                                                               |
| `DELETE /api/auth/sessions/:id`   | Revoke a session                                                                                                                                                                                                   |
| `DELETE /api/auth/sessions`       | Revoke all other sessions                                                                                                                                                                                          |
| `POST /api/auth/logout`           | End current session                                                                                                                                                                                                |
| `POST /api/auth/clear`            | Revoke all sessions and clear cookie                                                                                                                                                                               |
| `GET/PATCH /api/users/me`         | Codename, notify email, timezone, reminder/alert prefs                                                                                                                                                             |
| `POST /api/users`                 | Create or upsert user profile on first sign-in                                                                                                                                                                     |
| `GET/PATCH /api/profile`          | Per-user UI state — `currentMonth`, `tourPreference`, `toursSeen`; returns `id`, those fields, and `createdAt` (account age, used to gate release notes)                                                           |
| `CRUD /api/wallets`               | Financial wallets (metadata + E2EE `enc`/`payload` via PATCH)                                                                                                                                                      |
| `PUT /api/wallets/:id/budgets`    | Update encrypted wallet financials (`enc`/`payload`)                                                                                                                                                               |
| `GET/PUT /api/categories`         | Category taxonomy                                                                                                                                                                                                  |
| `CRUD /api/expenses`              | Transactions (scoped by wallet; cursor list via `limit`/`before`; optional series delete scopes)                                                                                                                   |
| `CRUD /api/events`                | Schedule events (comments + budget holds live in the E2EE payload; cursor list via `limit`/`before`)                                                                                                               |
| `CRUD /api/todo-lists`            | TO-DO lists and tasks                                                                                                                                                                                              |
| `CRUD /api/capital-plans`         | Capitals planners and their line items                                                                                                                                                                             |
| `CRUD /api/vehicles`              | Tracked vehicles (car/EV/bike/van)                                                                                                                                                                                 |
| `CRUD /api/vehicles/fills`        | Fuel fills or charges (cursor list via `limit`/`before`, filterable by `vehicleId`)                                                                                                                                |
| `GET/PATCH /api/consent`          | Data-sharing consent                                                                                                                                                                                               |
| `POST /api/budget-alerts`         | Deliver client-evaluated budget alerts (email; deduped)                                                                                                                                                            |
| `GET /api/fx/latest/:base`        | Cached FX rates (requires `EXCHANGE_RATE_API_KEY`)                                                                                                                                                                 |
| `GET /api/push/public-key`        | VAPID application server key for browser subscription                                                                                                                                                              |
| `POST/DELETE /api/push/subscribe` | Register or remove this device's Web Push endpoint                                                                                                                                                                 |
| `GET /api/cron/reminders`         | Auth: `Authorization: Bearer $CRON_SECRET`. Sends due reminders (email + Web Push) and materializes recurring expense rows                                                                                         |
| `POST /api/cron/notify-release`   | Auth: `Authorization: Bearer $CRON_SECRET`. Body `{ "version": "3.0.0" }`. Broadcasts a Web Push "app updated" notification to every subscribed device — called by CI after a successful deploy, not on a schedule |

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

Vercel is used for **hosting and Analytics / Speed Insights only** — it does not schedule jobs. Reminders and recurring expenses are triggered solely by [cron-job.org](https://cron-job.org) calling the hosted API.

The reminder handler does not use a fixed daily schedule. It polls the database on each run and delivers email when the current time falls in each event's window: **remind-at − 15 min ≤ now ≤ remind-at + 15 min** (so a reminder can fire slightly early). Set the external job to run **every 15 minutes**. Each poll is **batched** (document limits + ~22s time budget) so it stays under the ~30s cron-job.org / Vercel function timeout.

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

`.github/workflows/notify-release.yml` listens for GitHub's `deployment_status` event — which Vercel's GitHub integration posts automatically on every deploy — and on a successful **Production** deploy calls `POST /api/cron/notify-release` with the version from `package.json`, broadcasting a Web Push "app updated" notification to every subscribed device (needs the `VAPID_*` keys; silently no-ops if unset).

Add the same `CRON_SECRET` used for reminders as a **GitHub Actions repository secret** (`Settings → Secrets and variables → Actions`) so the workflow can authenticate, and add `environment: Production` to the job (already set) so it can read a `CRON_SECRET` scoped to the `Production` GitHub environment instead.

`github.event.deployment_status.target_url` is Vercel's unique per-deployment URL, not the production alias — if the project has Vercel Authentication (Deployment Protection) enabled, that URL 401s before the request reaches this app. Generate a token under Vercel Project Settings → Deployment Protection → **Protection Bypass for Automation**, and add it as the `VERCEL_AUTOMATION_BYPASS_SECRET` GitHub secret so the workflow's `x-vercel-protection-bypass` header can get past the wall.

Manual test:

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" \
  -d '{"version":"3.0.0"}' \
  "https://<your-app>.vercel.app/api/cron/notify-release"
```

### Verify after deploy

1. **Liveness check** — `GET https://<your-app>.vercel.app/` should return `200` and serve the app shell.
2. **Sign-in** — open the app, create or restore a wallet, complete the sign-in challenge, and confirm you land in the main UI.
3. **CRUD** — add an expense and a schedule event; refresh the page and confirm data persists.
4. **Wallets** — create a second wallet, switch between them, and confirm transactions stay scoped.
5. **Sessions** — open **Account → Data & privacy**, confirm your device appears in the session list, and test revoke / sign out.
6. **Exports** — open **Account → Exports & imports** to download an encrypted backup and/or CSV, then re-import.
7. **Transparency** — open the Transparency view and confirm hosting, inference, and collection maps render.
8. **Log payment** — create a bill event, use **Log payment**, and confirm the expense links back to the event.
9. **Budget hold** — enable a hold on a schedule event, confirm Budgets shows **Held**, then log payment and confirm the hold releases for that occurrence.
10. **Push notifications** — open **Account → Preferences**, enable push, and confirm the device registers (needs the `VAPID_*` keys; on iOS add the app to the Home Screen first).
11. **What's New** — confirm the release notes open on a device that has not seen this version, and that **Account → What's New** reopens them afterwards.
12. **First-run tour prompt** — sign in with a fresh wallet and confirm the welcome modal appears once. Choose **I'll explore** and confirm no tour auto-opens on any view and the prompt does not return after a reload; with another fresh wallet choose **Show me around**, close the shell tour with the X, and confirm it stays closed on reload.

### Serverless notes

- Rate limiting uses the shared Mongo `rate_limits` collection across function instances (in-memory fallback if the DB is unavailable). Profile cache and FX cache remain in-memory per instance.
- Cold starts may add latency on the first request while MongoDB connects; warm instances reuse the cached client.

## License

Custos is proprietary ([LICENSE](LICENSE)). The repository is public for **transparency and evaluation**.

- **Free to use** on the Licensor’s official hosted app (full features), under the in-app Terms. Optional anonymized category-total sharing is opt-in/out — your choice, changeable anytime.
- **Not free to self-host, rebrand, claim as your product, or offer as a competing service.** Those uses need a written commercial agreement (monthly fee, collaboration, or copyright buyout).
- Contact: [xianzyip8@gmail.com](mailto:xianzyip8@gmail.com)
