const FALLBACK_TIMEZONE = "Asia/Kuala_Lumpur";

/** Server may override via APP_TIMEZONE; browser bundles use the fallback. */
export const DEFAULT_TIMEZONE =
  typeof process !== "undefined" && process.env.APP_TIMEZONE
    ? process.env.APP_TIMEZONE
    : FALLBACK_TIMEZONE;

export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Convert a local calendar date + HH:mm in an IANA zone to UTC epoch ms. */
export function zonedLocalToUtcMs(dateIso: string, hhmm: string, timeZone: string): number {
  const [year, month, day] = dateIso.split("-").map(Number);
  const [hour, minute] = hhmm.split(":").map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    throw new Error(`Invalid date/time: ${dateIso} ${hhmm}`);
  }

  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 2; i++) {
    const inv = new Date(utc);
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = Object.fromEntries(
      formatter
        .formatToParts(inv)
        .filter((p) => p.type !== "literal")
        .map((p) => [p.type, p.value]),
    );
    const shownHour = Number(parts.hour === "24" ? "0" : parts.hour);
    const shownMinute = Number(parts.minute);
    const shownYear = Number(parts.year);
    const shownMonth = Number(parts.month);
    const shownDay = Number(parts.day);

    const targetMs = Date.UTC(year, month - 1, day, hour, minute, 0);
    const shownMs = Date.UTC(shownYear, shownMonth - 1, shownDay, shownHour, shownMinute, 0);
    utc += targetMs - shownMs;
  }
  return utc;
}

export function timezoneShortName(timeZone: string, at = new Date()): string {
  return (
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value ?? timeZone
  );
}

function formatTimezoneOption(timeZone: string, at = new Date()): string {
  const offset =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  const city = timeZone.split("/").pop()?.replace(/_/g, " ") ?? timeZone;
  return `${offset} · ${city}`;
}

/** Curated list for profile picker; browser zone is appended when missing. */
const COMMON_TIMEZONES = [
  "Pacific/Honolulu",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "UTC",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Kuala_Lumpur",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Australia/Sydney",
  "Pacific/Auckland",
] as const;

export function timezoneOptions(preferred?: string): string[] {
  const set = new Set<string>(COMMON_TIMEZONES);
  if (preferred && isValidTimezone(preferred)) set.add(preferred);
  return [...set].sort((a, b) => formatTimezoneOption(a).localeCompare(formatTimezoneOption(b)));
}
