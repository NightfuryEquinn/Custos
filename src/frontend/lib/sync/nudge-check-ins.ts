import { DEFAULT_TIMEZONE } from "@/lib/timezone";
import { cacheNudgeResult } from "./nudge-cache";
import { api, apiFetch, ApiError } from "@/frontend/lib/api";
import {
  decodeNudge,
  decodeNudgeCheckIn,
  encodeNudge,
  encodeNudgeCheckIn,
  type NudgeCheckInWire,
  type NudgeWire,
} from "@/frontend/lib/crypto/codec";
import { ledgerKeyStore } from "@/frontend/lib/crypto/key-store";
import { applyNudgeCheckIn } from "@/lib/nudge";
import { zonedTodayIso } from "@/lib/recurring";
import type { OutboxEntry } from "./types";

/** Each retry rebases the intended operation, preserving its id and original day. */
export async function sendNudgeEntry(entry: OutboxEntry) {
  const key = ledgerKeyStore.require(entry.address);
  const checkIn = entry.entity === "nudgeCheckIn";
  const wire = entry.request.body as NudgeCheckInWire;
  const id = checkIn ? wire.nudgeId : entry.targetId;
  if (entry.entity === "nudge" && entry.op === "create") {
    /* The queued body holds only ciphertext; rebuild the push copy for the first send. */
    const { user } = await api.users.me();
    const draft = await decodeNudge({ ...(entry.request.body as NudgeWire), id }, key);
    const today = zonedTodayIso(user.timezone ?? DEFAULT_TIMEZONE);
    const result = await apiFetch<{ nudge: NudgeWire }>(entry.request.path, {
      method: entry.request.method,
      body: { id, ...(await encodeNudge(draft, key, today)) },
    });
    await cacheNudgeResult(entry.address, result, entry.opId);
    return;
  }
  // Restores insert history only; their summary was restored with the parent.
  if (entry.request.method === "PUT") {
    await api.nudges.restoreCheckIn(wire);
    const { nudge } = await api.nudges.get(id, { fresh: true });
    await cacheNudgeResult(entry.address, { nudge, event: wire }, entry.opId);
    announceNudge(entry, nudge);
    return;
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const [{ nudge: current }, { user }] = await Promise.all([
      api.nudges.get(id, { fresh: true }),
      api.users.me(),
    ]);
    const latest = await decodeNudge(current, key);
    const today = zonedTodayIso(user.timezone ?? DEFAULT_TIMEZONE);
    let body: unknown;
    if (checkIn) {
      const event = await decodeNudgeCheckIn(wire, key);
      const applied = applyNudgeCheckIn(latest, event);
      body = {
        ...(await encodeNudgeCheckIn(applied.event, key)),
        nudge: await encodeNudge(applied.nudge, key, today),
        expectedRevision: current.revision ?? 0,
      };
    } else {
      const draft = await decodeNudge({ ...(entry.request.body as NudgeWire), id }, key);
      body = {
        ...(await encodeNudge(
          { ...draft, progress: latest.progress, history: latest.history },
          key,
          today,
        )),
        expectedRevision: current.revision ?? 0,
      };
    }
    try {
      const result = await apiFetch<{ nudge: NudgeWire; event?: NudgeCheckInWire }>(
        entry.request.path,
        { method: entry.request.method, body },
      );
      await cacheNudgeResult(entry.address, result, entry.opId);
      announceNudge(entry, result.nudge);
      return;
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 409 || attempt === 3) throw err;
    }
  }
}

function announceNudge(entry: OutboxEntry, nudge: NudgeWire) {
  if (typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent("custos:nudge-synced", {
        detail: { address: entry.address, opId: entry.opId, nudge },
      }),
    );
}
