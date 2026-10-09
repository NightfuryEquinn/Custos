/**
 * Offline write queue (the "outbox"). See src/frontend/lib/sync/engine.ts for
 * the drain loop and src/frontend/lib/sync/overlay.ts for how a pending
 * entry renders before it's confirmed.
 */

export type EntityKind =
  | "expense"
  | "wallet"
  | "walletBudgets"
  | "categories"
  | "event"
  | "todoList"
  | "capitalPlan"
  | "vehicle"
  | "vehicleFill"
  | "dailyRoutine"
  | "dailyCompletion"
  | "profile";

export type OutboxOp = "create" | "update" | "delete";

export type OutboxStatus = "pending" | "inflight" | "failed" | "blocked";

export type OutboxRequest = {
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  /** API path, e.g. "/expenses" or "/expenses/<id>" — no leading "/api". */
  path: string;
  /** Exactly what `apiFetch` would send — financial fields are always
   *  already-encrypted, but an event body also carries plaintext
   *  `notifyDetails` (title, hold amount/category, comments) by design:
   *  the server already stores that copy in the clear to render reminder
   *  emails, so this is the same trust boundary as the read cache, not a
   *  new one. See cipher-cache.ts's header comment. */
  body?: unknown;
};

export type OutboxEntry = {
  /** crypto.randomUUID() — IDB keyPath. */
  opId: string;
  /** Lowercased signed-in address this entry belongs to. */
  address: string;
  /** Per-address monotonic order — allocated in the same readwrite
   *  transaction as the insert, so it cannot race across tabs. */
  seq: number;
  entity: EntityKind;
  op: OutboxOp;
  /** The entity's id — client-minted for a create, existing for update/delete. */
  targetId: string;
  request: OutboxRequest;
  /** opIds of other unconfirmed entries this one references (cascade-blocking
   *  only, not scheduling — the drain is always strict seq order). */
  dependsOn: string[];
  /**
   * Locally-known truth the overlay should render, layered on top of
   * whatever `request` implies — the engine itself never reads this, only
   * `overlay.ts`. Two uses: (1) on a create/update, fields the request body
   * doesn't carry but a real server response would have supplied (e.g. a
   * client-minted `createdAt`); (2) on a "delete" whose scope doesn't
   * actually remove the row (e.g. a scoped event delete that only trims its
   * schedule) — the overlay patches the row with this instead of removing it.
   */
  overlayPatch?: Record<string, unknown>;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: number;
  /** Set while "inflight"; a lease past this point is reclaimable (a crashed
   *  drain, or a tab that closed mid-request). */
  leaseUntil?: number;
  lastError?: { status?: number; message: string; at: number };
  /** The opId of the create/update that permanently failed and blocked this
   *  entry via the dependsOn cascade — set only when status is "blocked". */
  blockedBy?: string;
  /** Short label for the sync-status UI. A fixed word about the kind of change
   *  ("Expense", "Routine check-in"), never text the user typed: it is stored as
   *  plain text in IndexedDB. See ./labels.ts. */
  label?: string;
  /** The readable name for the banner ("Coffee"), encrypted with the ledger key. */
  labelEnc?: string;
  createdAt: number;
  updatedAt: number;
};

/** A freshly-built entry before it's given an opId/seq/timestamps by enqueue(). */
export type NewOutboxEntry = Omit<
  OutboxEntry,
  "opId" | "seq" | "status" | "attempts" | "nextAttemptAt" | "createdAt" | "updatedAt"
>;
