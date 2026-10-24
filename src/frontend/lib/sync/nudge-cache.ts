import { identityStorage } from "@/frontend/auth/lib/identity-storage";
import { confirmOutbox } from "./outbox";
import { reqAsPromise, STORES } from "@/frontend/lib/pwa/idb";
import type { NudgeCheckInWire, NudgeWire } from "@/frontend/lib/crypto/codec";

/** Newest first, the same order the server pages in: day, then arrival counter, then id. */
function newestFirst(a: NudgeCheckInWire, b: NudgeCheckInWire) {
  return b.day.localeCompare(a.day) || (b.seq ?? 0) - (a.seq ?? 0) || b.id.localeCompare(a.id);
}

/** The continuation token the server hands out for the page ending at `event`. */
function cursorAfter(event: NudgeCheckInWire) {
  return `${event.day}|${event.seq ?? 0}|${event.id}`;
}

/** Commit acknowledged ciphertext and remove the outbox operation in one transaction. */
export async function cacheNudgeResult(
  address: string,
  result: { nudge: NudgeWire; event?: NudgeCheckInWire },
  opId: string,
) {
  await confirmOutbox(opId, async (tx) => {
    if (identityStorage.session()?.toLowerCase() !== address.toLowerCase()) return;
    const store = tx.objectStore(STORES.apiGets);
    const rows = await reqAsPromise<
      Array<{ key: string; address: string; path: string; body: string; updatedAt: number }>
    >(store.index("address").getAll(address.toLowerCase()));
    for (const row of rows) {
      let body: unknown;
      if (row.path === "/nudges") {
        const cached = JSON.parse(row.body) as { nudges: NudgeWire[] };
        body = {
          nudges: cached.nudges.some((n) => n.id === result.nudge.id)
            ? cached.nudges.map((n) => (n.id === result.nudge.id ? result.nudge : n))
            : [...cached.nudges, result.nudge],
        };
      } else if (row.path === `/nudges/${result.nudge.id}`) body = { nudge: result.nudge };
      else if (result.event && row.path.startsWith(`/nudges/${result.nudge.id}/check-ins?`)) {
        const filter = new URLSearchParams(row.path.split("?")[1]);
        if (
          filter.has("cursor") ||
          (filter.has("day") && filter.get("day") !== result.event.day) ||
          (!filter.has("day") &&
            filter.has("month") &&
            filter.get("month") !== result.event.day.slice(0, 7))
        )
          continue;
        const cached = JSON.parse(row.body) as {
          events: NudgeCheckInWire[];
          cursor: string | null;
        };
        const events = [
          ...cached.events.filter((e) => e.id !== result.event!.id),
          result.event,
        ].sort(newestFirst);
        const page = events.slice(0, 50);
        const last = page.at(-1);
        body = {
          events: page,
          cursor: events.length > 50 && last ? cursorAfter(last) : cached.cursor,
        };
      }
      if (body) store.put({ ...row, body: JSON.stringify(body), updatedAt: Date.now() });
    }
    if (result.event) {
      const path = `/nudges/${result.nudge.id}/check-ins?day=${result.event.day}`;
      if (!rows.some((row) => row.path === path)) {
        // A continuation explicitly indicates that older, uncached history may exist.
        store.put({
          key: `${address.toLowerCase()}|${path}`,
          address: address.toLowerCase(),
          path,
          updatedAt: Date.now(),
          body: JSON.stringify({
            events: [result.event],
            cursor: cursorAfter(result.event),
          }),
        });
      }
    }
  });
}

export async function cacheNudgeDeletion(address: string, id: string, opId: string) {
  await confirmOutbox(opId, async (tx) => {
    const store = tx.objectStore(STORES.apiGets);
    const rows = await reqAsPromise<Array<{ key: string; path: string; body: string }>>(
      store.index("address").getAll(address.toLowerCase()),
    );
    for (const row of rows) {
      if (row.path === `/nudges/${id}` || row.path.startsWith(`/nudges/${id}/check-ins?`))
        store.delete(row.key);
      else if (row.path === "/nudges") {
        const data = JSON.parse(row.body) as { nudges: NudgeWire[] };
        store.put({
          ...row,
          address: address.toLowerCase(),
          updatedAt: Date.now(),
          body: JSON.stringify({ nudges: data.nudges.filter((n) => n.id !== id) }),
        });
      }
    }
  });
}
