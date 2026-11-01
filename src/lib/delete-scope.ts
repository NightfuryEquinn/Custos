import { formatIsoDateParts, parseIsoDate } from "@/lib/recurring";

export const DELETE_SCOPES = ["this", "future", "all"] as const;
export type DeleteScope = (typeof DELETE_SCOPES)[number];

/** ISO calendar day immediately before `iso`. */
export function dayBeforeIso(iso: string): string {
  const { y, m, d } = parseIsoDate(iso);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));

  return formatIsoDateParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

type EventDeleteAction =
  { type: "except"; date: string } | { type: "until"; until: string } | { type: "delete" };

/**
 * Resolve how a recurring event should change for a delete scope.
 * Futures that start at the series anchor become a full delete.
 */
export function resolveEventDeleteAction(
  scope: DeleteScope,
  eventDate: string,
  fromDate: string,
): EventDeleteAction {
  if (scope === "this") return { type: "except", date: fromDate };
  if (scope === "all") return { type: "delete" };
  if (fromDate <= eventDate) return { type: "delete" };

  return { type: "until", until: dayBeforeIso(fromDate) };
}
