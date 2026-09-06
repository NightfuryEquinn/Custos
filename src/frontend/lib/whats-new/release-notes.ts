/** Glyph names available on the shared Icon component. */
type HighlightIcon =
  | "calendar"
  | "wallet"
  | "bell"
  | "insights"
  | "calculator"
  | "shield"
  | "download"
  | "sparkle"
  | "info"
  | "budget"
  | "piggy"
  | "capital"
  | "car"
  | "list"
  | "tags";

export type ReleaseHighlight = {
  icon: HighlightIcon;
  title: string;
  body: string;
};

export type ReleaseNotes = {
  version: string;
  date: string;
  lead: string;
  highlights: ReleaseHighlight[];
};

/**
 * Changelog shown by the What's New modal, newest first. Adding a release
 * means prepending an entry and bumping APP_VERSION in @/lib/version, which
 * re-announces the popup to every device that has not seen that version.
 */
export const RELEASE_NOTES: ReleaseNotes[] = [
  {
    version: "4.5.5",
    date: "September 2026",
    lead: "Calculator allocation can use a currency amount per category instead of only percentages, with a Percent / Amount toggle that converts your draft.",
    highlights: [
      {
        icon: "calculator",
        title: "Allocate by amount or percent",
        body: "Allocate by Category now has a Percent / Amount toggle. Type a currency amount per expense category until the total matches net after tax, or keep using percentages that total 100%. Switching modes converts the current draft when net is set.",
      },
      {
        icon: "budget",
        title: "Live remaining in currency",
        body: "Amount mode tracks leftover dollars on the same progress bar, so you can see how much is left or over before you apply to wallet budgets.",
      },
    ],
  },
  {
    version: "4.4.5",
    date: "September 2026",
    lead: "Wide desktop layouts get denser two-column reading for Budgets, Taxonomy, Transactions, and Upcoming; Calculator becomes a setup cockpit; Capital cards stay one column until 1280px; Transparency diagrams stack top-to-bottom; Insights and Fuel keep their editorial polish with a warmer light theme; dark mode contrast meets WCAG AA.",
    highlights: [
      {
        icon: "insights",
        title: "Insights and Fuel, redesigned",
        body: "What Stands Out, Spending Habit, Income Profile, Saving Insights, and Fuel Insights use a responsive bento layout with clearer metric cards, pastel tone washes, and denser signal tiles on phone, tablet, and desktop.",
      },
      {
        icon: "budget",
        title: "Wide-screen Budgets, Taxonomy, and lists",
        body: "From 1280px up, Budget by Category, Your Taxonomy, the Transactions list, and Schedule Upcoming switch to two-column card grids so long rows stop stretching across the monitor.",
      },
      {
        icon: "calculator",
        title: "Calculator cockpit",
        body: "Income and Tax Collection sit side-by-side on larger screens. Allocate by Category shows a live percentage progress bar and responsive allocation cards with Azeret Mono amounts.",
      },
      {
        icon: "capital",
        title: "Capital cards stay readable",
        body: "Capitals and Vehicles keep a single-column card stack until 1280px, then open to two columns so stats and actions are not cramped on laptop widths.",
      },
      {
        icon: "shield",
        title: "Vertical Transparency diagrams",
        body: "Hosting, data relationships, and the encrypted write path render top-to-bottom on every screen width, with diagrams capped for comfortable reading instead of horizontal sprawl.",
      },
      {
        icon: "sparkle",
        title: "Softer light mode and frameless chrome",
        body: "The light theme shifts from cool blue-white to a warm bone canvas. The sidebar and topbar drop their framing borders so the main canvas reads as one continuous surface. Type remains Young Serif, Schibsted Grotesk, and Azeret Mono — self-hosted SIL OFL.",
      },
      {
        icon: "info",
        title: "Accessible dark mode contrast",
        body: "Dark theme tokens now target WCAG 2.1 AA: brighter secondary labels, a lighter accent with dark ink on filled buttons, clearer card and input borders, stronger profile and progress colors, and calendar chip text that stays readable on charcoal surfaces.",
      },
    ],
  },
  {
    version: "4.3.5",
    date: "September 2026",
    lead: "Your notification email survives a PWA clear and re-sign-in, Data & privacy saves it more reliably, and What's New now reaches brand-new accounts after onboarding.",
    highlights: [
      {
        icon: "bell",
        title: "Notification email sticks after restore",
        body:
          "Re-signing in after clearing the PWA or switching devices rehydrates your saved notification address from the server and warms the field from local cache while it loads. " +
          "Budget alerts and reminder emails keep using the same inbox.",
      },
      {
        icon: "shield",
        title: "Clearer email editing in Data & privacy",
        body: "The notification address validates on save, persists on blur or Enter, and shows a clear error when the server is unreachable or the address is invalid.",
      },
      {
        icon: "sparkle",
        title: "What's New after onboarding",
        body: "Release notes now open for new accounts once the welcome modal and any guided tour finish, instead of being skipped entirely on first visit.",
      },
    ],
  },
  {
    version: "4.3.4",
    date: "September 2026",
    lead: "Built-in and custom categories now retire the same way, subcategories can be archived on their own, and archived items can be transferred onto another category without freezing the app.",
    highlights: [
      {
        icon: "tags",
        title: "Same retire rules for every category",
        body:
          "Expense, savings, and income categories — built-in or custom — delete when nothing is linked to them and archive when they have history. " +
          "Subcategories follow the same rule, so you no longer have to archive a whole parent to retire one in-use sub.",
      },
      {
        icon: "sparkle",
        title: "Transfer archived history",
        body:
          "Move transactions from an archived category or subcategory onto any live destination, including a different type. " +
          "A progress modal shows the paced remap so a large ledger cannot stall or crash the PWA.",
      },
      {
        icon: "info",
        title: "History stays classified",
        body:
          "Archived categories and subcategories stay resolvable so past rows keep their type until you transfer them. " +
          "You still cannot retire the last live income or expense category.",
      },
    ],
  },
  {
    version: "4.2.4",
    date: "September 2026",
    lead: "A clearer mobile home screen, reminder emails that name your events again, and polish across Overview, Transactions, Budgets, and Data & privacy.",
    highlights: [
      {
        icon: "sparkle",
        title: "Mobile tab bar + More",
        body:
          "On phone and tablet portrait, five primary tabs — Overview, Schedule, Transactions, To-Do, and More — replace the old scrolling bar. " +
          "Budget, Recurring, Vehicles, Categories, Piggies, Capitals, Calculator, Insights, and Transparency live in the More sheet.",
      },
      {
        icon: "bell",
        title: "Reminder emails use the event name",
        body:
          "Schedule reminders again include the real event title in email and push, using your account notify address — " +
          "not the deprecated per-event email field.",
      },
      {
        icon: "list",
        title: "Transactions that read in order",
        body:
          "The Transactions list and Overview recent rows sort newest-first, including by entry time on the same day. " +
          "Category Breakdown is a responsive card grid; Budget by Category keeps status and subcategories on one row.",
      },
      {
        icon: "info",
        title: "Overview and account polish",
        body:
          "Overview sections use View More on the header row. Data & privacy shows Loading… while your notify email loads. " +
          "The bottom bar stays pinned while you scroll, and sidebar / tab order matches the desktop list.",
      },
    ],
  },
  {
    version: "4.1.4",
    date: "August 2026",
    lead: "Security hardening, more reliable balances and budgets, encrypted backups that include Capitals and Vehicles, and clearer transparency about what the server can see.",
    highlights: [
      {
        icon: "shield",
        title: "Stronger defaults",
        body:
          "Security headers now cover the app document as well as API responses, push subscriptions cannot be hijacked across accounts, " +
          "and event reminders go only to your account notify email — never an arbitrary address typed on the event.",
      },
      {
        icon: "wallet",
        title: "Balances and budgets you can trust",
        body:
          "Starting-mode wallet balances now include transactions older than the 36-month window, the Budgets Available header nets withdrawals " +
          "against savings deposits, and monthly events on the 31st still appear in shorter months.",
      },
      {
        icon: "download",
        title: "Backups include Capitals and Vehicles",
        body: "Encrypted backups now carry your Capitals plans, vehicles, and fill history alongside wallets, categories, transactions, schedule, and todos.",
      },
      {
        icon: "info",
        title: "Transparency refresh",
        body:
          "The Transparency view documents push subscriptions, budget-alert plaintext, push subprocessors, and a 15-minute cron interval — " +
          "matching what the server actually stores and schedules.",
      },
    ],
  },
  {
    version: "4.1.3",
    date: "August 2026",
    lead: "Deleting something no longer leaves money counted nowhere: assigned savings go back to their envelope, budget holds re-reserve, and a category with old history can no longer be deleted by mistake.",
    highlights: [
      {
        icon: "capital",
        title: "Deleting a plan returns its savings",
        body:
          "Deposits you assigned to a Capital plan go back to their savings envelope instead of disappearing from " +
          "both Piggies and Capitals. Deposits stranded by a plan you deleted earlier come back on their own, and the " +
          "delete confirmation now tells you how much is about to move.",
      },
      {
        icon: "budget",
        title: "Budget holds re-reserve correctly",
        body:
          "Deleting the payment logged from a scheduled event now re-reserves that event's budget hold, including " +
          "across months and when you delete a whole recurring series — cases that previously left the envelope " +
          "quietly under-reserved.",
      },
      {
        icon: "piggy",
        title: "Safer category deletes",
        body:
          "Whether a category counts as in use is now judged on your full history across every wallet, not just the " +
          "recent months of the wallet you happen to have open, so a savings envelope with older deposits is archived " +
          "rather than deleted. Editing a logged fuel fill also no longer unlinks its ledger entry.",
      },
    ],
  },
  {
    version: "4.1.2",
    date: "August 2026",
    lead: "Capitals now counts money you set aside and then spend only once, so a plan's Unspent falls when you pay for something out of it.",
    highlights: [
      {
        icon: "capital",
        title: "Unspent follows your spending",
        body:
          "Paying a line item now draws down the savings you assigned to that plan instead of leaving them sitting there. " +
          "Plan cards show what you have set aside, what of it is still unspent, and what is still to save — figures that " +
          "previously subtracted the same money twice and under-stated how much you had left to put away.",
      },
      {
        icon: "budget",
        title: "Plans without a budget",
        body:
          "A plan with line items but no budget typed in now measures itself against the sum of those estimates, " +
          "so it no longer reads as Overpaid the moment you pay for anything.",
      },
    ],
  },
  {
    version: "4.1.1",
    date: "August 2026",
    lead: "Saving Insights now counts your Capitals plans alongside Piggies, you choose whether the guided tour runs, tours stop reappearing after you close them, and every button that talks to the server now looks the part while it works.",
    highlights: [
      {
        icon: "capital",
        title: "Saving Insights includes Capitals",
        body:
          "Money assigned to a Capitals plan is still money saved, so it now counts toward your savings rate, net saving, " +
          "streak, and best month — with the split between piggies and capitals shown alongside the total. On Insights, " +
          "each plan gets its own line: what is set aside, what is left to save, the monthly pace, and whether it is " +
          "funded, on pace, or behind for its target date. Saving Insights now lives on Insights only — Piggies keeps its " +
          "totals and each card's on-track status. Piggy pace is untouched: an assigned deposit is progress on the plan, " +
          "not the piggy. (Capitals draw-down math was refined in 4.1.2.)",
      },
      {
        icon: "info",
        title: "Your call on the tour",
        body:
          "The first time you sign in, Custos asks whether you want the guided walk-through or would rather explore " +
          "on your own. Pick either — the answer is saved to your account, so it follows you to every device instead of " +
          "being asked again on each new browser.",
      },
      {
        icon: "sparkle",
        title: "Tours that stay closed",
        body:
          "Closing a tour with the X used to count for nothing: it reopened on the very next load, every time. Dismissing " +
          "a tour now settles it. The ? beside any page title still replays that view's tour whenever you want it.",
      },
      {
        icon: "shield",
        title: "Buttons that show their state",
        body:
          "Cancel, Delete, Revoke, and the account menu now dim properly while a request is in flight instead of looking " +
          "clickable, and buttons no longer resize when their label switches to Saving…. Long category names ellipsize " +
          "inside their chip rather than spilling out of the row.",
      },
    ],
  },
  {
    version: "4.1.0",
    date: "August 2026",
    lead: "Smoother transitions across the app, a trefoil loader, safer saves when you tap fast, and stricter dev tooling to keep the codebase lean.",
    highlights: [
      {
        icon: "sparkle",
        title: "Trefoil loader",
        body:
          "Boot, ledger fetch, and lazy view switches now show a branded trefoil spinner instead of the hand-rolled bloom animation — " +
          "same playful wait messages, sharper visual polish.",
      },
      {
        icon: "shield",
        title: "Safer saves",
        body:
          "Double-clicks and Enter-then-blur on budgets, expenses, events, capitals, todos, and sign-out no longer fire duplicate " +
          "requests. Buttons show Saving… or Signing Out… while a change is in flight.",
      },
      {
        icon: "info",
        title: "Dev hygiene",
        body:
          "The repo now runs TypeScript type-checking and knip dead-code detection — run bun run typecheck and bun run knip " +
          "before shipping to catch unused exports and type errors early.",
      },
      {
        icon: "sparkle",
        title: "Unified motion",
        body:
          "Modals, views, pickers, and charts now animate through anime.js instead of scattered CSS keyframes — " +
          "including enter and exit on dialogs. Respects your OS reduce-motion setting.",
      },
    ],
  },
  {
    version: "4.0.0",
    date: "August 2026",
    lead: 'Meet Vehicles and Fuel Insights, plus a ranked "What Stands Out" feed that forecasts and flags anomalies in Transaction Insights.',
    highlights: [
      {
        icon: "car",
        title: "Meet Vehicles",
        body:
          "Track fuel or charging costs per vehicle — car, EV, bike, or van. Log fill-ups or charges with price, quantity, " +
          "odometer, and station, and optionally link one to a real ledger transaction with Log.",
      },
      {
        icon: "car",
        title: "Fuel Insights",
        body:
          "Once a vehicle has enough fill history, see consumption vs your own baseline, price timing, running-cost " +
          "projections, and cadence — generated on the Vehicles view. EVs automatically read as kWh, charge, and kWh/100km " +
          "instead of litres and fill-ups.",
      },
      {
        icon: "sparkle",
        title: "What Stands Out",
        body:
          "A new ranked feed on Insights surfaces month-end spend forecasts with a confidence band, over-budget categories " +
          "before the month ends, unusually large charges, category spend that has drifted, and recurring charges that are " +
          "new, gone quiet, or creeping up in price.",
      },
    ],
  },
  {
    version: "3.3.1",
    date: "August 2026",
    lead: "A quieter type system shared by the app and marketing site, plus summary cards that keep large amounts readable on phones.",
    highlights: [
      {
        icon: "sparkle",
        title: "Type refresh",
        body:
          "Headlines use Young Serif, UI copy uses Schibsted Grotesk, and amounts use Azeret Mono — " +
          "the same stack on the marketing site. Tracking is opened slightly for easier reading.",
      },
      {
        icon: "budget",
        title: "Summary cards that fit",
        body:
          "Summary amounts stay between 20px and 24px. On tablet and phone the grid reflows " +
          "(including five-card Budgets and Capitals rows) so 8–9 digit figures do not overflow.",
      },
    ],
  },
  {
    version: "3.3.0",
    date: "August 2026",
    lead: "Route savings to a Capital plan as Unspent, pick savings deadlines with the same calendar as Events, and cleaner category rows.",
    highlights: [
      {
        icon: "capital",
        title: "Unspent on Capitals",
        body:
          "When you add a savings deposit, optionally assign it to a Capital plan — it shows as Unspent on that plan's card " +
          "and reduces the monthly save hint. Leave it on Piggies when no plan is selected. (Draw-down math was refined in 4.1.2.)",
      },
      {
        icon: "piggy",
        title: "Piggies vs Capitals",
        body:
          "Unassigned savings still land in Piggies as before. Capital-assigned deposits are excluded from piggy balances " +
          "so the same money is never counted twice.",
      },
      {
        icon: "sparkle",
        title: "Savings deadline picker + category layout",
        body:
          "Add Savings Category now uses the custom date picker (same as Capitals and Transactions). " +
          "Category rows in the tree use a flex layout for name, tags, and meta.",
      },
    ],
  },
  {
    version: "3.2.0",
    date: "August 2026",
    lead: "Unlock with Face ID, and the Notification menu is now Preferences.",
    highlights: [
      {
        icon: "shield",
        title: "Face ID / Touch ID unlock",
        body:
          "Skip typing your device passphrase — enable Face ID or Touch ID for this device from Account → Preferences, " +
          "or when offered right after you unlock with your passphrase. Your passphrase is encrypted with a key tied to " +
          "the biometric check and never leaves this device.",
      },
      {
        icon: "bell",
        title: "Notification → Preferences",
        body: "The per-device Notification menu is now Preferences, home to push notifications and Face ID together.",
      },
    ],
  },
  {
    version: "3.1.2",
    date: "August 2026",
    lead: "Capitals plans get a total budget, a monthly save hint from budget minus paid, and a summary of savings across every plan.",
    highlights: [
      {
        icon: "capital",
        title: "Total budget per plan",
        body:
          "Set the total budget for a Capitals plan. Paid line items count against it. The donut shows paid as a " +
          "percent of that budget — and flips to Overpaid when you spend past it.",
      },
      {
        icon: "piggy",
        title: "Monthly save + totals",
        body:
          "With a target date, each card shows how much to save per month: (budget − paid) ÷ months left. " +
          "A new Monthly Saving summary card totals that amount across every plan. (Monthly-save math was refined in 4.1.2.)",
      },
    ],
  },
  {
    version: "3.0.2",
    date: "August 2026",
    lead: "Capitals uses the same date picker as Events, plus tighter mobile modal spacing.",
    highlights: [
      {
        icon: "capital",
        title: "Capitals date picker",
        body:
          "New and edit plan modals now use the custom calendar picker — the same one on Events " +
          "and Transactions — instead of the browser's native date field.",
      },
      {
        icon: "sparkle",
        title: "Roomier mobile modals",
        body:
          "On phones, every modal gets extra space under the action buttons so Cancel and Save " +
          "no longer sit flush against the screen edge.",
      },
    ],
  },
  {
    version: "3.0.1",
    date: "August 2026",
    lead: "Every reminder now also fires right at the event — plus a fix for a blank-page load.",
    highlights: [
      {
        icon: "bell",
        title: "A reminder at the event, always",
        body:
          "Any event with reminders on now also sends one right at its own start — the clock " +
          "time for a timed event, or 9:00 AM on the day for an all-day one — on top of whatever " +
          "lead time you picked.",
      },
      {
        icon: "shield",
        title: "Fixed a blank-load bug",
        body:
          "Some deploys of 3.0.0 could load to a blank screen. The build now always ships the " +
          "correct startup script.",
      },
    ],
  },
  {
    version: "3.0.0",
    date: "August 2026",
    lead: "Capitals: plan for the big stuff, plus subcategory breakdowns and a snappier app load.",
    highlights: [
      {
        icon: "capital",
        title: "Meet Capitals",
        body:
          "Plan for marriages, trips, loans, or anything custom with a template or a blank plan, " +
          "check off line items as paid, and log a real payment straight into your ledger.",
      },
      {
        icon: "budget",
        title: "By Category, expanded",
        body:
          "Overview's By Category card and Transactions now break down every category into its " +
          "subcategories, with amounts and share of total.",
      },
      {
        icon: "sparkle",
        title: "Faster to open",
        body:
          "Views now load on demand instead of all at once, so the app starts noticeably faster, " +
          "especially on a cold cache.",
      },
      {
        icon: "calendar",
        title: "New Event picks up where you left off",
        body:
          "Select a day on the Schedule calendar first — New Event now defaults to that date " +
          "instead of always today.",
      },
    ],
  },
  {
    version: "2.0.0",
    date: "August 2026",
    lead: "Piggies: a one-glance tracker for every savings goal, plus a Saving Insights engine.",
    highlights: [
      {
        icon: "piggy",
        title: "Meet Piggies",
        body:
          "Every savings category is now a piggy with a real balance, an optional target and " +
          "deadline, and a progress ring. Subcategories show as piglets inside it.",
      },
      {
        icon: "sparkle",
        title: "Saving Insights",
        body:
          "Streaks, best months, savings rate, and pace-vs-deadline projections, generated from " +
          "your saving history and surfaced on both the Piggies and Insights views.",
      },
      {
        icon: "wallet",
        title: "Withdrawals, properly accounted",
        body:
          "Take money back out of a piggy without it being mistaken for income anywhere in the " +
          "app — budgets, charts, and your savings rate all account for it correctly.",
      },
      {
        icon: "budget",
        title: "Connected everywhere",
        body:
          "Piggies link from Overview, Budgets, and Categories, and export to their own CSV " +
          "alongside your transactions, schedule, and to-do lists.",
      },
    ],
  },
  {
    version: "1.1.1",
    date: "August 2026",
    lead: "A full changelog, a type refresh, and menus that stay on screen on a phone.",
    highlights: [
      {
        icon: "sparkle",
        title: "Changelog, not a one-shot note",
        body:
          "Account → What's New lists every version in one scroll. Got It stays at the bottom, " +
          "so you can close the modal without reading the whole archive.",
      },
      {
        icon: "info",
        title: "Type refresh",
        body:
          "Headlines, body copy, and figures now use Fraunces, Inter, and Roboto Mono. The " +
          "ledger should read a little clearer on both desktop and phone.",
      },
      {
        icon: "budget",
        title: "Chart labels stay inside the circle",
        body:
          "Donut-chart totals and captions no longer spill out of the ring. Long values ellipsize " +
          "instead of colliding with the slices.",
      },
      {
        icon: "wallet",
        title: "Menus you can actually reach",
        body:
          "On tablet and phone, the account, wallet, and month dropdowns now scroll inside the " +
          "panel. Sign Out and Manage Wallets no longer sit under the bottom nav.",
      },
    ],
  },
  {
    version: "1.1.0",
    date: "August 2026",
    lead: "A maintenance release: a faster Insights tab, a fixed install icon, and a squashed startup crash.",
    highlights: [
      {
        icon: "insights",
        title: "Snappier Insights",
        body:
          "The overview and spending-habit panels no longer recompute on every render. Switching " +
          "months, periods, or currency now updates only what actually changed.",
      },
      {
        icon: "shield",
        title: "Fixed a load-time crash",
        body:
          "A hooks-ordering bug could crash the app right as your ledger finished loading. Fixed at " +
          "the root: the loading and loaded states now use the exact same hooks.",
      },
      {
        icon: "download",
        title: "Install icon, fixed",
        body:
          "The home-screen icon and splash screen were pointing at a path that didn't exist in " +
          "production. Installing Custos now shows the right icon immediately.",
      },
    ],
  },
  {
    version: "1.0.0",
    date: "August 2026",
    lead: "Custos reaches 1.0. Here is what your ledger can do now.",
    highlights: [
      {
        icon: "calendar",
        title: "A schedule that bends",
        body:
          "Events can span multiple days, repeat weekly or biweekly, and recurring series let you " +
          "delete just this occurrence, this and everything after, or the whole series.",
      },
      {
        icon: "wallet",
        title: "Bills tied to your budget",
        body:
          "Put a hold on a budget envelope when you schedule a bill, so the money is already spoken " +
          "for. Logging the payment releases the hold and links the transaction back to the event.",
      },
      {
        icon: "bell",
        title: "Reminders worth reading",
        body:
          "Email reminders now carry the event name, its budget hold and your comments. All-day " +
          "events get day-of reminders, and you can switch on browser push notifications instead.",
      },
      {
        icon: "insights",
        title: "Sharper insights",
        body:
          "The overview trend charts earnings alongside spending, hovering any point breaks the " +
          "total down by category, and spending habits highlight where the month actually went.",
      },
      {
        icon: "calculator",
        title: "Budget calculator",
        body:
          "Build a month's budget from your own categories, see it balance against your income, " +
          "and apply it to the ledger in one step.",
      },
      {
        icon: "shield",
        title: "Private by construction",
        body:
          "Your ledger is end-to-end encrypted in the browser before it is stored. Review active " +
          "sessions, sign out other devices, and clear everything this browser holds at any time.",
      },
      {
        icon: "download",
        title: "Yours to take with you",
        body:
          "Export and re-import transactions, schedule and to-do lists as CSV, or take an encrypted " +
          "backup. Install Custos to your home screen and it keeps working offline for reads.",
      },
    ],
  },
];
