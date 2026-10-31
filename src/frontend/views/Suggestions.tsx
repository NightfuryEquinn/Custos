import { useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog, EmptyState, Segmented } from "@/frontend/components/ui";
import { useEnter } from "@/frontend/lib/animate";
import type { useLedger } from "@/frontend/lib/hooks/useLedger";
import { usePersonalization } from "@/frontend/lib/hooks/usePersonalization";
import {
  changePersonalization,
  resetPersonalization,
  recordBehaviour,
} from "@/frontend/lib/personalization-client";
import { generateSuggestions, rankSuggestions } from "@/frontend/lib/recommendations";
import type { SearchTarget } from "@/frontend/lib/search/model";
import { api } from "@/frontend/lib/api";
import { decodeEvent } from "@/frontend/lib/crypto/codec";
import { ledgerKeyStore } from "@/frontend/lib/crypto/key-store";
import type { LedgerEvent } from "@/frontend/lib/types";
import { shiftIso } from "@/lib/schedule";
const TONES = ["neutral", "warning", "critical"] as const;
export function PersonalizationSettings({ address }: { address: string }) {
  const { snapshot, error } = usePersonalization(address);
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState(""),
    [confirmClear, setConfirmClear] = useState(false);
  const on = snapshot?.pref.enabled ?? false;
  const toggle = async (enabled: boolean) => {
    setBusy(true);
    setFailure("");
    try {
      await changePersonalization(address, enabled);
    } catch {
      setFailure(
        "Could not confirm the change online. Turning off clears this device immediately; deletion retries online.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="consent-card">
        <div className="consent-top">
          <div>
            <div className="consent-title">Personalised Suggestions</div>
            <p className="consent-desc">
              Analyse your existing records on this device and remember limited feature use and
              feedback for up to 30 days. History syncs encrypted across your devices. Custos cannot
              read its contents. Turning this off erases recommendation history and learned
              preferences.
            </p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              aria-label="Allow personalised suggestions and encrypted history"
              checked={on}
              disabled={busy || !snapshot || (!snapshot.available && !on)}
              onChange={(e) => void toggle(e.target.checked)}
            />
            <span className="toggle-ui" />
          </label>
        </div>
        <div className={`consent-status ${on ? "cs-on" : "cs-off"}`}>
          <span className="cs-dot" />
          {on
            ? "On — history syncs encrypted for up to 30 days"
            : "Off — no recommendation history"}
        </div>
      </div>
      {snapshot && !snapshot.available && (
        <p className="dm-note">Personalisation is not currently available on this host.</p>
      )}
      {on && (
        <button
          type="button"
          className="ghost-btn sm danger"
          disabled={busy}
          onClick={() => setConfirmClear(true)}
        >
          Clear recommendation history
        </button>
      )}
      {snapshot?.deletionPending && (
        <p className="dm-note" role="status">
          Deletion pending online. Other offline devices clear their copies when they reconnect.
        </p>
      )}
      {(failure || error) && (
        <p className="dm-note" role="status">
          {failure || error}
        </p>
      )}
      <p className="dm-note">
        History is not included in backups. Existing insights remain available when this is off.
      </p>
      {confirmClear && (
        <ConfirmDialog
          title="Clear recommendation history?"
          message="This erases your recommendation history and resets what Custos learned about your preferences."
          confirmLabel="Clear history"
          pendingLabel="Clearing…"
          arm={false}
          onConfirm={async () => {
            await resetPersonalization(address);
            setConfirmClear(false);
          }}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </>
  );
}
export function Suggestions({
  ledger,
  address,
  onOpen,
}: {
  ledger: ReturnType<typeof useLedger>;
  address: string;
  onOpen: (target: SearchTarget, events: LedgerEvent[]) => void;
}) {
  const viewRef = useRef<HTMLDivElement>(null);
  useEnter(viewRef);
  const { snapshot, error } = usePersonalization(address);
  const [historyLimit, setHistoryLimit] = useState(50);
  const [tab, setTab] = useState<"suggestions" | "history">("suggestions"),
    [hidden, setHidden] = useState<string[]>([]);
  const [schedule, setSchedule] = useState<LedgerEvent[] | null>(null),
    [scheduleError, setScheduleError] = useState(false);
  const today = ledger.daily.today;
  const enabled = !!snapshot?.pref.enabled;
  useEffect(() => {
    let active = true;
    if (!enabled || !today) return;
    const months = [...new Set([today.slice(0, 7), shiftIso(today, 3).slice(0, 7)])];
    void (async () => {
      const rows: LedgerEvent[] = [];
      for (const month of months) {
        let before: string | undefined, beforeId: string | undefined;
        for (;;) {
          const page = await api.events.list({ month, limit: 2000, before, beforeId });
          rows.push(
            ...(await Promise.all(
              page.events.map((e) => decodeEvent(e, ledgerKeyStore.require(address))),
            )),
          );
          if (!page.hasMore) break;
          if (!page.nextBefore || rows.length >= 10000) throw new Error("Schedule incomplete");
          before = page.nextBefore;
          beforeId = page.nextBeforeId ?? undefined;
        }
      }
      if (active) {
        setSchedule([...new Map(rows.map((e) => [e.id, e])).values()]);
        setScheduleError(false);
      }
    })().catch(() => {
      if (active) {
        setSchedule(null);
        setScheduleError(true);
      }
    });
    return () => {
      active = false;
    };
  }, [address, enabled, today, ledger.homeEvents]);
  const candidates = useMemo(
    () => (enabled && today ? generateSuggestions(ledger, today, schedule) : []),
    [enabled, today, ledger, schedule],
  );
  const ranked = useMemo(
    () => rankSuggestions(candidates, snapshot?.events ?? []).filter((c) => !hidden.includes(c.id)),
    [candidates, snapshot?.events, hidden],
  );
  useEffect(() => {
    if (enabled && tab === "suggestions")
      for (const c of ranked) void recordBehaviour(address, "shown", c.domain, c.id);
  }, [address, enabled, tab, ranked]);
  return (
    <div ref={viewRef} className="view">
      {enabled && (
        <section className="panel">
          <div className="panel-head insights-chart-head">
            <h2>Suggestions</h2>
            <Segmented
              label="Suggestions sections"
              options={[
                { v: "suggestions", label: "Suggestions" },
                { v: "history", label: "History" },
              ]}
              value={tab}
              onChange={setTab}
            />
          </div>
          {tab === "suggestions" ? (
            <>
              {!ledger.financialHistoryComplete && (
                <p className="panel-sub" role="status">
                  Financial history is incomplete; budget and savings suggestions are paused.
                </p>
              )}
              {scheduleError && (
                <p className="panel-sub" role="status">
                  Schedule coverage is unavailable; bill and budget suggestions are paused.
                </p>
              )}
              {!schedule && !scheduleError && (
                <p className="panel-sub" role="status">
                  Loading suggestions…
                </p>
              )}
              {!ranked.length && (schedule || scheduleError) && (
                <EmptyState
                  title="No suggestions right now"
                  sub="More complete records can help."
                />
              )}
              <div className="insight-feed">
                {ranked.map((c) => (
                  <article
                    className={`insight-card tone-${TONES[c.priority] ?? "critical"}`}
                    key={c.id}
                  >
                    <div className="insight-card-head">
                      <span className="insight-card-title">{c.title}</span>
                    </div>
                    <p className="insight-card-body">{c.reason}</p>
                    <details className="editorial-details">
                      <summary>Why this suggestion?</summary>
                      <p className="panel-sub">
                        Based on your recorded {c.domain} data. Recent feature use and
                        helpful/dismiss feedback adjust the order within urgency levels. Calculated
                        on this device; engine version 1.
                      </p>
                    </details>
                    <div className="suggestion-actions">
                      <button
                        type="button"
                        className="ghost-btn sm"
                        onClick={() => {
                          void recordBehaviour(address, "opened", c.domain, c.id);
                          onOpen(c.target, schedule ?? []);
                        }}
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        className="ghost-btn sm"
                        onClick={() => {
                          void recordBehaviour(address, "helpful", c.domain, c.id);
                          setHidden((h) => [...h, c.id]);
                        }}
                      >
                        Helpful
                      </button>
                      <button
                        type="button"
                        className="ghost-btn sm"
                        onClick={() => {
                          void recordBehaviour(address, "dismissed", c.domain, c.id);
                          setHidden((h) => [...h, c.id]);
                        }}
                      >
                        Dismiss for 7 days
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="panel-sub">
                Limited activity used for suggestions, retained for up to 30 days. At most 60 events
                a day; this is not a complete activity audit.
              </p>
              {snapshot?.events.length ? (
                <ol className="suggestion-history">
                  {[...snapshot.events]
                    .sort((a, b) => b.at.localeCompare(a.at))
                    .slice(0, historyLimit)
                    .map((e) => (
                      <li key={e.id}>
                        <time dateTime={e.at}>{new Date(e.at).toLocaleString()}</time>
                        <span>
                          {e.domain}: {e.type} · engine {e.engine}
                        </span>
                      </li>
                    ))}
                </ol>
              ) : (
                <EmptyState title="No retained history" />
              )}
              {(snapshot?.events.length ?? 0) > historyLimit && (
                <button
                  type="button"
                  className="ghost-btn sm"
                  onClick={() => setHistoryLimit((n) => n + 50)}
                >
                  Show more history
                </button>
              )}
            </>
          )}
          {error && (
            <p className="panel-sub" role="status">
              {error}
            </p>
          )}
        </section>
      )}
      <section className="panel">
        <div className="panel-head panel-head--stack">
          <div>
            <h2>Personalisation</h2>
            <p className="panel-sub">
              Suggestions are calculated on this device from records you already keep.
            </p>
          </div>
        </div>
        <PersonalizationSettings address={address} />
      </section>
    </div>
  );
}
