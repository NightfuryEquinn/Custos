import { api } from "@/frontend/lib/api";
import {
  decodeNudge,
  decodeNudgeCheckIn,
  type NudgeCheckInWire,
  type NudgeWire,
} from "@/frontend/lib/crypto/codec";
import { ledgerKeyStore } from "@/frontend/lib/crypto/key-store";
import { listOutbox } from "@/frontend/lib/sync/outbox";
import { applyNudgeCheckIn } from "@/lib/nudge";

/** Walk every page; a failed page aborts export instead of silently truncating history. */
export async function loadNudgeBackup(address: string) {
  const key = ledgerKeyStore.require(address);
  const { nudges: wires } = await api.nudges.list({ fresh: true });
  const nudges = new Map(
    (await Promise.all(wires.map((wire) => decodeNudge(wire, key)))).map((row) => [row.id, row]),
  );
  const events = new Map<string, Awaited<ReturnType<typeof decodeNudgeCheckIn>>>();
  for (const row of nudges.values()) {
    let cursor: string | undefined;
    do {
      const page = await api.nudges.checkIns(row.id, { cursor }, { fresh: true });
      for (const wire of page.events) events.set(wire.id, await decodeNudgeCheckIn(wire, key));
      cursor = page.cursor ?? undefined;
    } while (cursor);
  }
  for (const entry of await listOutbox(address)) {
    if (entry.entity === "nudge") {
      if (entry.op === "delete") {
        nudges.delete(entry.targetId);
        continue;
      }
      const row = await decodeNudge(
        { ...(entry.request.body as NudgeWire), id: entry.targetId },
        key,
      );
      const previous = nudges.get(row.id);
      nudges.set(
        row.id,
        previous ? { ...row, progress: previous.progress, history: previous.history } : row,
      );
    } else if (entry.entity === "nudgeCheckIn" && !events.has(entry.targetId)) {
      const event = await decodeNudgeCheckIn(entry.request.body as NudgeCheckInWire, key);
      const row = nudges.get(event.nudgeId);
      if (!row) continue;
      const applied = applyNudgeCheckIn(row, event);
      if (entry.request.method !== "PUT") nudges.set(row.id, applied.nudge);
      events.set(event.id, entry.request.method === "PUT" ? event : applied.event);
    }
  }
  return {
    nudges: [...nudges.values()],
    nudgeCheckIns: [...events.values()].filter((event) => nudges.has(event.nudgeId)),
  };
}
