import { useStagger } from "@/frontend/lib/animate";
import { ACCOUNT_STALE_DAYS } from "@/lib/account-retention";
import { LoadingBloom } from "@/frontend/components/LoadingBloom";
import { useEffect, useId, useRef, useState } from "react";

/*
 * Transparency — read-only data map
 * ─────────────────────────────────
 * Shows how Custos persists data: collection relationships,
 * E2EE write path, and each document's keys (with example values).
 */

type Field = { key: string; value: string; note?: string };

type CollectionDoc = {
  name: string;
  purpose: string;
  encrypted?: boolean;
  fields: Field[];
};

const COLLECTIONS: CollectionDoc[] = [
  {
    name: "users",
    purpose: "Wallet identity and notification preferences",
    fields: [
      {
        key: "address",
        value: '"0xabc…"',
        note: "SIWE login address only (unique); prefer a ledger-only key",
      },
      { key: "codename", value: '"Maple Owl"' },
      { key: "notifyEmail?", value: '"you@mail.com"' },
      { key: "timezone?", value: '"Asia/Kuala_Lumpur"' },
      { key: "emailRemindersEnabled?", value: "true" },
      { key: "budgetAlertsEnabled?", value: "true" },
      {
        key: "supporterSince?",
        value: "ISO date",
        note: "set only by the manual grant script — a one-time Lifetime Supporter unlock",
      },
      {
        key: "lastSeenAt?",
        value: "ISO date",
        note: `Login / session activity; stale accounts purged after ${ACCOUNT_STALE_DAYS} days`,
      },
      { key: "createdAt / updatedAt", value: "ISO dates" },
    ],
  },
  {
    name: "ledger_profiles",
    purpose: "Per-user UI state (selected month, guided-tour onboarding)",
    fields: [
      { key: "accountId", value: '"64b6…"', note: "users._id hex (opaque)" },
      { key: "currentMonth", value: '"2026-07"', note: "YYYY-MM" },
      { key: "tourPreference", value: '"guided"', note: "pending | guided | explore" },
      { key: "toursSeen", value: '["shell", "overview"]', note: "tour ids already shown" },
      {
        key: "termsVersion?",
        value: '"2026-09-13"',
        note: "Terms version accepted; undefined means never accepted",
      },
      { key: "createdAt / updatedAt", value: "ISO dates" },
    ],
  },
  {
    name: "financial_wallets",
    purpose: "Wallets — income, starting balance, and budgets",
    encrypted: true,
    fields: [
      { key: "accountId", value: '"64b6…"', note: "users._id hex (opaque)" },
      { key: "currency", value: '"MYR"' },
      { key: "fundingMode", value: '"monthly" | "starting"' },
      { key: "enc", value: "1", note: "E2EE version" },
      { key: "payload", value: "base64 AES-GCM", note: "name, income, startingBalance, budgets" },
      { key: "isDefault", value: "true" },
      { key: "createdAt / updatedAt", value: "ISO dates" },
    ],
  },
  {
    name: "category_taxonomies",
    purpose: "Expense / income category tree per user",
    encrypted: true,
    fields: [
      { key: "accountId", value: '"64b6…"', note: "users._id hex (opaque)" },
      { key: "enc", value: "1", note: "E2EE version" },
      {
        key: "payload",
        value: "base64 AES-GCM",
        note: "categories[] tree, incl. piggy target/deadline",
      },
      { key: "createdAt / updatedAt", value: "ISO dates" },
    ],
  },
  {
    name: "expenses",
    purpose: "Transactions (expense or income)",
    encrypted: true,
    fields: [
      { key: "accountId", value: '"64b6…"', note: "users._id hex (opaque)" },
      { key: "walletId", value: "ObjectId", note: "random ObjectId (no timestamp)" },
      { key: "kind", value: '"expense" | "income"' },
      { key: "date", value: '"2026-07-16"' },
      { key: "recurring", value: "false | interval" },
      { key: "enc", value: "1" },
      { key: "payload", value: "base64 AES-GCM", note: "sub, amount, note" },
      { key: "seriesKey?", value: "sha256 hex", note: "recurring series id" },
      { key: "eventId?", value: "ObjectId", note: "optional link to a schedule event (plaintext)" },
      {
        key: "capitalPlanId?",
        value: "ObjectId",
        note: "optional link to a Capitals plan when savings is assigned (plaintext)",
      },
      { key: "skipped?", value: "false", note: "soft-delete for recurring cron" },
      { key: "createdAt / updatedAt", value: "ISO dates" },
    ],
  },
  {
    name: "events",
    purpose: "Calendar events and reminders",
    encrypted: true,
    fields: [
      { key: "accountId", value: '"64b6…"', note: "users._id hex (opaque)" },
      { key: "enc", value: "1", note: "E2EE version" },
      {
        key: "payload",
        value: "base64 AES-GCM",
        note: "title, comments, customLabel/Glyph, budget hold fields",
      },
      { key: "catId", value: '"bill" | "custom" | …' },
      { key: "date", value: '"2026-07-20"' },
      {
        key: "endDate? / endTime?",
        value: "multi-day span bounds",
        note: "inclusive last day; end clock on timed spans",
      },
      { key: "allDay / time / repeat", value: "schedule metadata" },
      { key: "exceptDates? / until?", value: "recurrence exceptions / end date" },
      { key: "notify / lead", value: "reminder settings (plaintext for cron)" },
      {
        key: "email?",
        value: '"you@mail.com"',
        note: "legacy per-event field; delivery uses users.notifyEmail",
      },
      {
        key: "notifyDetails?",
        value: "title, hold, comments",
        note: "readable copy for email/push while notify is on — deleted when notify is off",
      },
      {
        key: "expenseId?",
        value: "ObjectId",
        note: "optional link when a bill payment was logged",
      },
      { key: "createdAt / updatedAt", value: "ISO dates" },
    ],
  },
  {
    name: "todo_lists",
    purpose: "Named task lists",
    encrypted: true,
    fields: [
      { key: "accountId", value: '"64b6…"', note: "users._id hex (opaque)" },
      { key: "enc", value: "1", note: "E2EE version" },
      { key: "payload", value: "base64 AES-GCM", note: "name, icon, tasks[]" },
      { key: "createdAt / updatedAt", value: "ISO dates" },
    ],
  },
  {
    name: "capital_plans",
    purpose:
      "Future-expense planners (marriage, trips, loans, custom) with total budget, monthly save, and a pot of savings assigned via linked transactions; paying line items draws down that pot",
    encrypted: true,
    fields: [
      { key: "accountId", value: '"64b6…"', note: "users._id hex (opaque)" },
      { key: "enc", value: "1", note: "E2EE version" },
      {
        key: "payload",
        value: "base64 AES-GCM",
        note: "name, templateId, glyph, targetDate, initialBudget, items[]",
      },
      { key: "createdAt / updatedAt", value: "ISO dates" },
    ],
  },
  {
    name: "vehicles",
    purpose: "Tracked vehicles — car, EV, bike, or van",
    encrypted: true,
    fields: [
      { key: "accountId", value: '"64b6…"', note: "users._id hex (opaque)" },
      { key: "type", value: '"car" | "ev" | "bike" | "van"' },
      { key: "enc", value: "1", note: "E2EE version" },
      {
        key: "payload",
        value: "base64 AES-GCM",
        note: "name, model, plate, glyph, odometerStart, tankCapacity, notes",
      },
      { key: "createdAt / updatedAt", value: "ISO dates" },
    ],
  },
  {
    name: "vehicle_fills",
    purpose: "Fuel fills or charging sessions for a vehicle",
    encrypted: true,
    fields: [
      { key: "accountId", value: '"64b6…"', note: "users._id hex (opaque)" },
      { key: "vehicleId", value: "ObjectId" },
      { key: "date", value: '"2026-07-16"' },
      { key: "partial", value: "false", note: "true when the tank/battery was not filled to full" },
      { key: "expenseId?", value: "ObjectId", note: "optional link once Log to ledger runs" },
      { key: "enc", value: "1", note: "E2EE version" },
      { key: "payload", value: "base64 AES-GCM", note: "price, quantity, odometer, station" },
      { key: "createdAt / updatedAt", value: "ISO dates" },
    ],
  },
  {
    name: "consent",
    purpose: "Third-party data-sharing opt-in",
    fields: [
      { key: "accountId", value: '"64b6…"', note: "users._id hex (opaque)" },
      { key: "optedIn", value: "false" },
      { key: "createdAt / updatedAt", value: "ISO dates" },
    ],
  },
  {
    name: "auth_nonces",
    purpose: "One-time SIWE / sign-in challenges",
    fields: [
      { key: "address", value: '"0xabc…"' },
      { key: "nonce", value: "random string" },
      { key: "message", value: "sign-in message" },
      { key: "expiresAt", value: "Date" },
      { key: "usedAt?", value: "Date" },
      { key: "createdAt", value: "Date" },
    ],
  },
  {
    name: "sessions",
    purpose: "Authenticated browser sessions",
    fields: [
      { key: "accountId", value: '"64b6…"', note: "opaque users._id" },
      {
        key: "address?",
        value: '"0xabc…"',
        note: "legacy sessions keyed by address only until backfill",
      },
      { key: "tokenHash", value: "hashed cookie token (rotated on sliding renewal)" },
      { key: "userAgent / ip", value: "client metadata" },
      { key: "createdAt / lastSeenAt / expiresAt", value: "Dates" },
      { key: "revokedAt?", value: "Date" },
    ],
  },
  {
    name: "push_subscriptions",
    purpose: "Web Push endpoints — one row per browser; the row is the opt-in",
    fields: [
      { key: "accountId", value: '"64b6…"', note: "users._id hex (opaque)" },
      { key: "endpoint", value: "https://…", note: "unique; FCM, Mozilla, or Apple push host" },
      {
        key: "keys.p256dh / keys.auth",
        value: "base64",
        note: "required verbatim to encrypt each push payload",
      },
      { key: "createdAt / updatedAt", value: "ISO dates" },
    ],
  },
  {
    name: "reminder_logs",
    purpose: "Dedupes sent event reminders per occurrence and channel (email and push)",
    fields: [
      { key: "accountId", value: '"64b6…"', note: "users._id hex (opaque)" },
      { key: "eventId", value: "ObjectId" },
      { key: "occurrenceIso", value: "ISO datetime" },
      {
        key: "lead",
        value: '"1d" | "at" | "span"',
        note: "one row per reminder kind — the chosen lead, the always-on at-event send, and multi-day ongoing sends are logged separately",
      },
      { key: "email", value: '"you@mail.com"', note: "account notify address at send time" },
      { key: "channels?", value: '["email","push"]', note: "absent on pre-push rows (email-only)" },
      { key: "sentAt", value: "Date", note: "TTL index (~400 days)" },
    ],
  },
  {
    name: "budget_alert_logs",
    purpose:
      "Dedupes budget-near-limit email and push delivery (client evaluates; server delivers)",
    fields: [
      { key: "accountId", value: '"64b6…"', note: "users._id hex (opaque)" },
      { key: "walletId / categoryId", value: "ids" },
      { key: "month", value: '"2026-07"' },
      { key: "level", value: '"warning" | "exceeded"' },
      {
        key: "email / channels? / sentAt",
        value: "delivery record",
        note: "TTL index (~400 days) on sentAt",
      },
    ],
  },
  {
    name: "rate_limits",
    purpose: "Shared API rate-limit buckets across serverless instances",
    fields: [
      { key: "_id", value: '"global:1.2.3.4"', note: "prefix + client key" },
      { key: "count", value: "12" },
      { key: "resetAt", value: "Date", note: "TTL index expires the bucket" },
    ],
  },
];

const RELATIONSHIP_CHART = `flowchart TB
  subgraph Client["Browser client"]
    direction TB
    UI["React UI<br/>sidebar · tab bar + More sheet"]
    Key["In-memory ledger key<br/>from wallet signature"]
    LS["localStorage<br/>identities · session · theme · tour<br/>active wallet · prefs · whatsnew"]
    UI --> Key
    UI --> LS
  end

  subgraph API["API / MongoDB"]
    direction TB
    Users["users"]
    Profile["ledger_profiles"]
    Wallets["financial_wallets<br/>enc + payload"]
    Cats["category_taxonomies<br/>enc + payload"]
    Exp["expenses<br/>enc + payload"]
    Ev["events<br/>enc + payload"]
    Todos["todo_lists<br/>enc + payload"]
    Caps["capital_plans<br/>enc + payload"]
    Vehicles["vehicles<br/>enc + payload"]
    Fills["vehicle_fills<br/>enc + payload"]
    Consent["consent"]
    Auth["auth_nonces · sessions"]
    Push["push_subscriptions"]
    Logs["reminder_logs · budget_alert_logs"]
    Users --> Profile
    Users --> Wallets
    Users --> Cats
    Users --> Exp
    Users --> Ev
    Users --> Todos
    Users --> Caps
    Users --> Vehicles
    Users --> Consent
    Users --> Auth
    Users --> Push
    Vehicles --> Fills
    Fills -.->|"optional link"| Exp
    Ev --> Logs
    Wallets --> Logs
  end

  Client -->|"session cookie"| API
  Key -.->|"AES-256-GCM"| Wallets
  Key -.->|"AES-256-GCM"| Cats
  Key -.->|"AES-256-GCM"| Exp
  Key -.->|"AES-256-GCM"| Ev
  Key -.->|"AES-256-GCM"| Todos
  Key -.->|"AES-256-GCM"| Caps
  Key -.->|"AES-256-GCM"| Vehicles
  Key -.->|"AES-256-GCM"| Fills
`;

/** Mobile uses the same top-to-bottom relationship map as desktop. */
const RELATIONSHIP_CHART_MOBILE = RELATIONSHIP_CHART;

const E2EE_CHART = `flowchart TB
  Plain["Plain fields<br/>dates · kinds · schedule metadata<br/>reminder prefs · link ids"]
  Enc["AES-256-GCM encrypt<br/>with ledger key"]
  Doc["Mongo document<br/>enc: 1<br/>payload: base64 blob"]
  DB[("MongoDB")]
  DbOut["Fetch document"]
  Decr["AES-256-GCM decrypt<br/>in browser"]
  Ready["UI sees plaintext<br/>E2EE fields stay ciphertext on server"]

  Plain --> Enc --> Doc --> DB
  DB --> DbOut --> Decr --> Ready
`;

/** Mobile: same write path stacked top-to-bottom. */
const E2EE_CHART_MOBILE = E2EE_CHART;

/** Hosting and scheduler roles — free-tier stack (vertical for readability). */
const SYSTEM_CHART = `flowchart TB
  Browser["Browser<br/>unlock · encrypt · PWA cache"]
  Vercel["Vercel Hobby<br/>host SPA + API<br/>Analytics only"]
  Atlas[("MongoDB Atlas M0<br/>ciphertext + metadata")]
  Cron["cron-job.org<br/>HTTP poll every ~15 min"]
  Resend["Resend<br/>reminder / alert email"]
  PushSvc["FCM · APNs · Mozilla<br/>Web Push delivery"]

  Browser -->|"HTTPS session"| Vercel
  Vercel -->|"read/write docs"| Atlas
  Cron -->|"GET /api/cron/reminders"| Vercel
  Vercel -->|"send email"| Resend
  Vercel -->|"send push"| PushSvc
`;

const SYSTEM_CHART_MOBILE = SYSTEM_CHART;

const MOBILE_MQ = "(max-width: 860px)";

/** Read the current color theme for Mermaid. */
function readTheme(): "dark" | "neutral" {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "neutral";
}

/** Track whether the viewport matches the tablet/mobile breakpoint. */
function useIsMobile() {
  const [mobile, setMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(MOBILE_MQ).matches : false,
  );

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    /** Sync React state when the media query flips. */
    const onChange = () => setMobile(mq.matches);

    onChange();
    mq.addEventListener("change", onChange);

    return () => mq.removeEventListener("change", onChange);
  }, []);

  return mobile;
}

function MermaidDiagram({
  chart,
  mobileChart,
  label,
}: {
  chart: string;
  mobileChart?: string;
  label: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const reactId = useId().replace(/:/g, "");
  const isMobile = useIsMobile();
  const activeChart = isMobile && mobileChart ? mobileChart : chart;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;

    /** Render (or re-render) the Mermaid SVG into the host. */
    const render = async () => {
      try {
        setLoading(true);
        const mermaid = (await import("mermaid")).default;
        if (cancelled) return;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: readTheme(),
          flowchart: { curve: "basis", htmlLabels: true, padding: 12 },
        });
        const id = `mmd-${reactId}-${Math.random().toString(36).slice(2, 8)}`;
        const { svg } = await mermaid.render(id, activeChart);
        if (cancelled || !hostRef.current) return;
        hostRef.current.innerHTML = svg;
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to render diagram");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void render();

    const obs = new MutationObserver(() => {
      void render();
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      cancelled = true;
      obs.disconnect();
    };
  }, [activeChart, reactId]);

  return (
    <div className="transparency-diagram" role="img" aria-label={label}>
      {loading ? <LoadingBloom label="Rendering diagram…" size="sm" /> : null}
      {error ? <p className="transparency-error">{error}</p> : null}
      <div ref={hostRef} className="transparency-mermaid" />
    </div>
  );
}

function CollectionCard({ doc }: { doc: CollectionDoc }) {
  return (
    <article className="transparency-card">
      <header className="transparency-card-head">
        <h3>
          <code>{doc.name}</code>
        </h3>
        {doc.encrypted ? <span className="transparency-badge">E2EE payload</span> : null}
      </header>
      <p className="transparency-card-purpose">{doc.purpose}</p>
      <dl className="transparency-kv">
        {doc.fields.map((f) => (
          <div key={f.key} className="transparency-kv-row">
            <dt>
              <code>{f.key}</code>
            </dt>
            <dd>
              <code>{f.value}</code>
              {f.note ? <span className="transparency-note">{f.note}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

export function Transparency() {
  const viewRef = useRef<HTMLDivElement>(null);
  useStagger(viewRef, ".panel");

  return (
    <div ref={viewRef} className="view transparency-view">
      <section className="panel" data-tour="tour-transparency-intro">
        <div className="panel-head panel-head--stack">
          <div>
            <h2>How the Whole System Works</h2>
            <p className="panel-sub">
              Custos is private by design: your browser derives a ledger key from your wallet
              signature, encrypts secrets with AES-256-GCM, and syncs ciphertext to MongoDB Atlas.
              Vercel hosts the app and API (plus Analytics / Speed Insights) but does not run cron.
              cron-job.org is the only scheduler — it polls
              <code> GET /api/cron/reminders </code>
              about every fifteen minutes for email reminders, push notifications, and recurring
              expense rows. Optional email uses Resend; push delivery uses FCM, Apple Push, or
              Mozilla&apos;s service depending on the browser. UI typefaces (Young Serif, Schibsted
              Grotesk, Azeret Mono from <code>fonts.css</code>) ship with the app as self-hosted SIL
              OFL files — no third-party font CDN. Mermaid diagrams below stack top-to-bottom so
              they stay readable at every width. On desktop you navigate from the sidebar; on phone
              and tablet portrait a five-tab bar (Overview, Schedule, Transactions, To-Do, More)
              opens a sheet for the remaining views. A device passphrase wraps your in-app recovery
              key on this browser; encrypted backups download to your machine only. Optional Face ID
              / Touch ID unlock runs entirely in the browser through WebAuthn — it can prompt on its
              own when you open the app, but the server never receives the credential, the
              assertion, or any signal that a biometric check happened. The installable PWA may
              cache ciphertext locally for offline reads — saves still need the network. Older rows
              may still carry legacy plaintext columns from before E2EE payloads.
            </p>
          </div>
        </div>
      </section>

      <section className="panel" data-tour="tour-transparency-system">
        <div className="panel-head panel-head--stack">
          <div>
            <h2>Hosting &amp; Jobs</h2>
            <p className="panel-sub">
              Free-tier roles: Vercel hosts, Atlas stores, cron-job.org schedules; typefaces ship
              with the app
            </p>
          </div>
        </div>
      </section>

      <section className="panel" data-tour="tour-transparency-infer">
        <div className="panel-head panel-head--stack">
          <div>
            <h2>What the Server Can Infer</h2>
            <p className="panel-sub">
              Even with E2EE, plaintext metadata remains for queries and accurate schedule reminders
              (day-level dates, multi-day <code>endDate</code> / <code>endTime</code> span bounds,
              and lead times are intentional — not bucketed). Owned documents are keyed by an opaque{" "}
              <code>accountId</code> (<code>users._id</code>); the SIWE wallet address lives only on{" "}
              <code>users</code> for login. The server can still see that address, session cookies
              (HttpOnly, rotated on sliding renewal), wallet currencies/funding modes, expense
              dates/kinds/recurrence flags, schedule timing including multi-day spans, your account
              notify email and reminder lead times, and that a budget-alert or reminder delivery
              occurred — but not transaction amounts, wallet names, category trees, notes, event
              titles, or to-do text. Budget alerts are a deliberate exception: the client sends
              cleartext <code>spent</code>, <code>budget</code>, <code>categoryName</code>, and
              optional <code>walletName</code> so the email or push can name the category and
              amounts. Schedule reminders with notify on also store <code>notifyDetails</code> — the
              title, budget hold, and comments the notification carries — only while notify is
              enabled; switching it off deletes that copy. Linking a bill payment stores plaintext{" "}
              <code>eventId</code> / <code>expenseId</code> references only; assigning savings to a
              Capitals plan stores <code>capitalPlanId</code> on the expense (link id only, not
              amounts). A fuel fill's vehicle type stays plaintext for the vocabulary switch
              (car/EV/bike/van), and logging it to the ledger stores a plaintext{" "}
              <code>expenseId</code> on the fill — again a link id only, never amounts.
            </p>
            <p className="panel-sub" style={{ marginTop: "0.75rem" }}>
              If the same auth key is ever used on-chain, chain analysis can correlate it with this
              account. Prefer a <strong>ledger-only</strong> identity created in-app (not a funded
              exchange or hot wallet). Optional notification email plus timing metadata still form
              an identity/behavior graph without decrypting ciphertext. E2EE does not remove
              data-protection obligations for plaintext metadata under regimes like GDPR/CCPA — not
              legal advice; get a lawyer&apos;s read if you ship commercially.
            </p>
            <p className="panel-sub" style={{ marginTop: "0.75rem" }}>
              Automatic Face ID / Touch ID unlock changes nothing here: the server still only sees a
              normal signature-based sign-in and cannot tell a biometric unlock from a typed
              passphrase.
            </p>
          </div>
        </div>
      </section>

      <section className="panel" data-tour="tour-transparency-flow">
        <div className="panel-head panel-head--stack">
          <div>
            <h2>Data Relationships</h2>
            <p className="panel-sub">
              Opaque accountId anchors every user-owned collection; SIWE address stays on users
            </p>
          </div>
        </div>
      </section>

      <section className="panel" data-tour="tour-transparency-e2ee">
        <div className="panel-head panel-head--stack">
          <div>
            <h2>Encrypted Write Path</h2>
            <p className="panel-sub">
              Categories, events, todos, expenses, capital plans, vehicles/fills, and wallet
              names/budgets are AES-256-GCM encrypted client-side before save
            </p>
          </div>
        </div>
      </section>

      <section className="panel" data-tour="tour-transparency-collections">
        <div className="panel-head panel-head--stack">
          <div>
            <h2>Collections · Keys &amp; Values</h2>
            <p className="panel-sub">Each Mongo document stores these fields</p>
          </div>
        </div>
        <div className="transparency-grid">
          {COLLECTIONS.map((doc) => (
            <CollectionCard key={doc.name} doc={doc} />
          ))}
        </div>
      </section>

      <section className="panel" data-tour="tour-transparency-diagrams">
        <div className="panel-head panel-head--stack">
          <div>
            <h2>Diagrams</h2>
            <p className="panel-sub">
              Visual maps of hosting, collection links, and the encrypted write path — top-to-bottom
              for comfortable reading
            </p>
          </div>
        </div>
        <div className="transparency-diagram-stack">
          <div>
            <h3 className="transparency-diagram-title">Hosting &amp; Jobs</h3>
            <MermaidDiagram
              chart={SYSTEM_CHART}
              mobileChart={SYSTEM_CHART_MOBILE}
              label="System Hosting Flowchart"
            />
          </div>
          <div>
            <h3 className="transparency-diagram-title">Data Relationships</h3>
            <MermaidDiagram
              chart={RELATIONSHIP_CHART}
              mobileChart={RELATIONSHIP_CHART_MOBILE}
              label="Collection Relationship Flowchart"
            />
          </div>
          <div>
            <h3 className="transparency-diagram-title">Encrypted Write Path</h3>
            <MermaidDiagram
              chart={E2EE_CHART}
              mobileChart={E2EE_CHART_MOBILE}
              label="E2EE save flowchart"
            />
          </div>
        </div>
      </section>
    </div>
  );
}
