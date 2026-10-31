export const PERSONALIZATION_NOTICE = "personalization-v1";
export const HISTORY_COLLECTION = "personalization_history";
export const HISTORY_DAYS = 30;
export const HISTORY_LIMIT = 60;
export type PersonalizationConsent = { enabled: boolean; noticeVersion: string; epoch: number };
export const emptyPersonalization = (): PersonalizationConsent => ({
  enabled: false,
  noticeVersion: PERSONALIZATION_NOTICE,
  epoch: 0,
});
export type HistoryBucket = {
  accountId: string;
  epoch: number;
  day: string;
  expiresAt: Date;
  events: { id: string; payload: string }[];
};
export function mergeHistoryEvents(
  previous: HistoryBucket["events"],
  incoming: HistoryBucket["events"],
) {
  const events = [...previous];
  const accepted: string[] = [],
    duplicate: string[] = [],
    dropped: string[] = [];
  for (const event of incoming) {
    if (events.some((e) => e.id === event.id)) duplicate.push(event.id);
    else if (events.length >= HISTORY_LIMIT) dropped.push(event.id);
    else {
      events.push(event);
      accepted.push(event.id);
    }
  }
  return { events, accepted, duplicate, dropped };
}
export function historyExpiry(day: string): Date {
  return new Date(Date.parse(day + "T00:00:00Z") + HISTORY_DAYS * 86400000);
}
export function validHistoryDay(day: string, now = Date.now()): boolean {
  const date = Date.parse(day + "T00:00:00Z");
  return (
    Number.isFinite(date) &&
    new Date(date).toISOString().slice(0, 10) === day &&
    date <= now &&
    historyExpiry(day).getTime() > now
  );
}
