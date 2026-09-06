import { describe, expect, test } from "bun:test";
import {
  collapseRecurringToNext,
  eventDaysByMonth,
  eventSpanLabel,
  eventTimeLabel,
  eventsForDay,
  scheduleForMonth,
} from "@/frontend/lib/data";
import { holdsByCategory } from "@/frontend/lib/envelope-holds";
import type { LedgerEvent } from "@/frontend/lib/types";
import {
  coversOn,
  occurrenceStartFor,
  occursOn,
  reminderTargets,
  spanDays,
  type ScheduleEvent,
} from "@/lib/schedule";
import { createEventSchema } from "@/schemas/event";
import { isRepeatAllowedForSpan } from "@/schemas/common";

const TZ = "Asia/Kuala_Lumpur";
const MONTH = "2026-08";

type SpanEvent = {
  id: string;
  date: string;
  endDate?: string | null;
  repeat: string;
  allDay?: boolean;
  time?: string | null;
  endTime?: string | null;
  title?: string;
  until?: string | null;
  exceptDates?: string[];
};

/** Minimal all-day event, optionally spanning to `endDate`. */
function ev(partial: Partial<SpanEvent> & Pick<SpanEvent, "id" | "date" | "repeat">): SpanEvent {
  return { allDay: true, time: null, title: partial.id, ...partial };
}

/** Days in `MONTH` that any occurrence of `event` covers. */
function coveredDays(event: SpanEvent): string[] {
  const out: string[] = [];
  for (const [iso, list] of eventDaysByMonth([event], MONTH)) {
    if (list.length) out.push(iso);
  }

  return out.sort();
}

describe("span geometry", () => {
  test("spanDays counts both ends, and treats a missing or backwards end as single-day", () => {
    expect(spanDays({ date: "2026-08-10" })).toBe(1);
    expect(spanDays({ date: "2026-08-10", endDate: null })).toBe(1);
    expect(spanDays({ date: "2026-08-10", endDate: "2026-08-10" })).toBe(1);
    expect(spanDays({ date: "2026-08-10", endDate: "2026-08-13" })).toBe(4);
    expect(spanDays({ date: "2026-08-10", endDate: "2026-08-01" })).toBe(1);
  });

  test("occursOn still means 'starts on', while coversOn means 'is running'", () => {
    const trip = ev({ id: "t", date: "2026-08-10", endDate: "2026-08-13", repeat: "once" });

    expect(occursOn(trip, "2026-08-10")).toBe(true);
    expect(occursOn(trip, "2026-08-11")).toBe(false);

    expect(coversOn(trip, "2026-08-09")).toBe(false);
    expect(coversOn(trip, "2026-08-10")).toBe(true);
    expect(coversOn(trip, "2026-08-13")).toBe(true);
    expect(coversOn(trip, "2026-08-14")).toBe(false);
  });

  test("every covered day resolves back to the occurrence that owns it", () => {
    const weekly = ev({
      id: "w",
      date: "2026-08-03",
      endDate: "2026-08-05",
      repeat: "weekly",
    });

    expect(occurrenceStartFor(weekly, "2026-08-05")).toBe("2026-08-03");
    expect(occurrenceStartFor(weekly, "2026-08-12")).toBe("2026-08-10");
    expect(occurrenceStartFor(weekly, "2026-08-06")).toBeNull();
  });

  test("a weekly 3-day span covers Mon-Wed each week and nothing else", () => {
    const weekly = ev({
      id: "w",
      date: "2026-08-03", // Monday
      endDate: "2026-08-05",
      repeat: "weekly",
    });

    expect(coveredDays(weekly)).toEqual([
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
      "2026-08-17",
      "2026-08-18",
      "2026-08-19",
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
      "2026-08-31",
    ]);
  });

  test("exceptDates and until apply to the occurrence start, removing the whole run", () => {
    const weekly = ev({
      id: "w",
      date: "2026-08-03",
      endDate: "2026-08-05",
      repeat: "weekly",
      exceptDates: ["2026-08-10"],
      until: "2026-08-17",
    });

    /* The excepted occurrence takes its middle and end days with it. */
    expect(coversOn(weekly, "2026-08-10")).toBe(false);
    expect(coversOn(weekly, "2026-08-11")).toBe(false);
    expect(coversOn(weekly, "2026-08-12")).toBe(false);

    /* `until` bounds starts, so the 17th's run still finishes on the 19th. */
    expect(coversOn(weekly, "2026-08-17")).toBe(true);
    expect(coversOn(weekly, "2026-08-19")).toBe(true);
    expect(coversOn(weekly, "2026-08-24")).toBe(false);
  });

  test("eventsForDay lists an event on a day it merely runs through", () => {
    const trip = ev({ id: "t", date: "2026-08-10", endDate: "2026-08-13", repeat: "once" });

    expect(eventsForDay([trip], "2026-08-12").map((e) => e.id)).toEqual(["t"]);
    expect(eventsForDay([trip], "2026-08-14")).toEqual([]);
  });

  test("eventDaysByMonth tags each covered day with its position in the run", () => {
    const trip = ev({ id: "t", date: "2026-08-10", endDate: "2026-08-13", repeat: "once" });
    const byDay = eventDaysByMonth([trip], MONTH);

    expect(byDay.get("2026-08-10")![0]).toMatchObject({
      dayIndex: 0,
      span: 4,
      startIso: "2026-08-10",
    });
    expect(byDay.get("2026-08-12")![0]).toMatchObject({
      dayIndex: 2,
      span: 4,
      startIso: "2026-08-10",
    });
  });
});

describe("repeat ladder", () => {
  test("a repeat is offered only while the next occurrence starts after this one ends", () => {
    /* An ordinary single-day event repeating daily is the base case. */
    expect(isRepeatAllowedForSpan("daily", 1)).toBe(true);
    expect(isRepeatAllowedForSpan("daily", 2)).toBe(false);

    expect(isRepeatAllowedForSpan("weekly", 7)).toBe(true);
    expect(isRepeatAllowedForSpan("weekly", 8)).toBe(false);

    expect(isRepeatAllowedForSpan("biweekly", 14)).toBe(true);
    expect(isRepeatAllowedForSpan("biweekly", 15)).toBe(false);

    expect(isRepeatAllowedForSpan("monthly", 28)).toBe(true);
    expect(isRepeatAllowedForSpan("monthly", 29)).toBe(false);

    /* "once" never repeats, so no span can overlap it. */
    expect(isRepeatAllowedForSpan("once", 400)).toBe(true);
  });

  test("createEventSchema rejects a span that would overlap its own repeat", () => {
    const base = {
      catId: "personal" as const,
      date: "2026-08-10",
      allDay: true,
      enc: 1 as const,
      payload: "x".repeat(24),
    };

    /* 3-day run, daily repeat — the second run would start mid-first. */
    expect(
      createEventSchema.safeParse({ ...base, endDate: "2026-08-12", repeat: "daily" }).success,
    ).toBe(false);
    /* 8-day run, weekly repeat. */
    expect(
      createEventSchema.safeParse({ ...base, endDate: "2026-08-17", repeat: "weekly" }).success,
    ).toBe(false);
    /* 7-day run ends exactly as the next begins. */
    expect(
      createEventSchema.safeParse({ ...base, endDate: "2026-08-16", repeat: "weekly" }).success,
    ).toBe(true);
    expect(
      createEventSchema.safeParse({ ...base, endDate: "2026-08-12", repeat: "weekly" }).success,
    ).toBe(true);
  });

  test("createEventSchema rejects a backwards end and an all-day end time", () => {
    const base = {
      catId: "personal" as const,
      date: "2026-08-10",
      enc: 1 as const,
      payload: "x".repeat(24),
    };

    expect(
      createEventSchema.safeParse({ ...base, allDay: true, endDate: "2026-08-09" }).success,
    ).toBe(false);
    expect(
      createEventSchema.safeParse({
        ...base,
        allDay: true,
        endDate: "2026-08-12",
        endTime: "11:00",
      }).success,
    ).toBe(false);
    expect(
      createEventSchema.safeParse({
        ...base,
        allDay: false,
        time: "15:00",
        endDate: "2026-08-10",
        endTime: "14:00",
      }).success,
    ).toBe(false);
  });
});

describe("budget holds", () => {
  /** Held event covering four days. */
  function heldEvent(overrides: Partial<LedgerEvent> = {}): LedgerEvent {
    return {
      id: "h1",
      title: "Conference",
      catId: "personal",
      date: "2026-08-10",
      endDate: "2026-08-13",
      allDay: true,
      time: null,
      repeat: "once",
      notify: false,
      lead: "1d",
      email: "",
      comments: [],
      budgetHoldEnabled: true,
      budgetHoldAmount: 250,
      budgetHoldCategoryId: "cat-travel",
      ...overrides,
    } as LedgerEvent;
  }

  test("a four-day event holds its budget once, not once a day", () => {
    expect(holdsByCategory([heldEvent()], MONTH)).toEqual({ "cat-travel": 250 });
  });

  test("a repeating multi-day event holds once per occurrence", () => {
    /* Aug 3, 10, 17, 24, 31 start in this month — five occurrences. */
    const repeating = heldEvent({ date: "2026-08-03", endDate: "2026-08-05", repeat: "weekly" });

    expect(holdsByCategory([repeating], MONTH)).toEqual({ "cat-travel": 250 * 5 });
  });

  test("scheduleForMonth yields occurrence starts only", () => {
    const trip = ev({ id: "t", date: "2026-08-10", endDate: "2026-08-13", repeat: "once" });

    expect(scheduleForMonth([trip], MONTH).map((o) => o.iso)).toEqual(["2026-08-10"]);
  });
});

describe("agenda collapsing", () => {
  /** Covered days from today onward, the way the Schedule agenda builds them. */
  function agenda(events: SpanEvent[], todayIso: string) {
    const out: Array<{
      iso: string;
      ev: SpanEvent;
      startIso: string;
      dayIndex: number;
      span: number;
    }> = [];
    for (const [, list] of eventDaysByMonth(events, MONTH)) out.push(...list);

    return out.filter((o) => o.iso >= todayIso).sort((a, b) => a.iso.localeCompare(b.iso));
  }

  test("a multi-day run collapses to a single upcoming row", () => {
    const trip = ev({ id: "t", date: "2026-08-10", endDate: "2026-08-13", repeat: "once" });
    const now = new Date(2026, 7, 4, 9, 0);

    const out = collapseRecurringToNext(agenda([trip], "2026-08-04"), now);

    expect(out.map((o) => o.iso)).toEqual(["2026-08-10"]);
  });

  test("a run that started before today stays visible, anchored to today", () => {
    const trip = ev({ id: "t", date: "2026-08-10", endDate: "2026-08-13", repeat: "once" });
    const now = new Date(2026, 7, 12, 9, 0);

    const out = collapseRecurringToNext(agenda([trip], "2026-08-12"), now);

    expect(out.map((o) => o.iso)).toEqual(["2026-08-12"]);
    expect(out[0]!.dayIndex).toBe(2);
  });

  test("a repeating span still collapses to one row across occurrences", () => {
    const weekly = ev({ id: "w", date: "2026-08-03", endDate: "2026-08-05", repeat: "weekly" });
    const now = new Date(2026, 7, 4, 9, 0);

    const out = collapseRecurringToNext(agenda([weekly], "2026-08-04"), now);

    expect(out.map((o) => o.iso)).toEqual(["2026-08-04"]);
  });

  test("a timed span stays on its last day until the end time", () => {
    const trip = ev({
      id: "t",
      date: "2026-08-10",
      endDate: "2026-08-13",
      repeat: "once",
      allDay: false,
      time: "15:00",
      endTime: "11:00",
    });
    const morning = new Date(2026, 7, 13, 9, 0);
    const afternoon = new Date(2026, 7, 13, 12, 0);

    expect(
      collapseRecurringToNext(agenda([trip], "2026-08-13"), morning).map((o) => o.iso),
    ).toEqual(["2026-08-13"]);
    expect(collapseRecurringToNext(agenda([trip], "2026-08-13"), afternoon)).toEqual([]);
  });
});

describe("labels", () => {
  const day = (dayIndex: number, span: number) => ({ dayIndex, span });

  test("an all-day span reads as all day throughout", () => {
    const trip = { allDay: true, time: null, date: "2026-08-10", endDate: "2026-08-13" };

    expect(eventTimeLabel(trip, day(0, 4))).toBe("All day");
    expect(eventTimeLabel(trip, day(3, 4))).toBe("All day");
  });

  test("a timed span with no end time shows the start time and never invents an end", () => {
    const trip = { allDay: false, time: "15:00", date: "2026-08-10", endDate: "2026-08-13" };

    expect(eventTimeLabel(trip, day(0, 4))).toBe("3:00 PM");
    expect(eventTimeLabel(trip, day(1, 4))).toBe("All day");
    expect(eventTimeLabel(trip, day(3, 4))).toBe("All day");
  });

  test("a timed span with an end time brackets the run", () => {
    const trip = {
      allDay: false,
      time: "15:00",
      endTime: "11:00",
      date: "2026-08-10",
      endDate: "2026-08-13",
    };

    expect(eventTimeLabel(trip, day(0, 4))).toBe("from 3:00 PM");
    expect(eventTimeLabel(trip, day(1, 4))).toBe("All day");
    expect(eventTimeLabel(trip, day(3, 4))).toBe("until 11:00 AM");
  });

  test("single-day events keep their existing labels", () => {
    expect(eventTimeLabel({ allDay: true, time: null, date: "2026-08-10" })).toBe("All day");
    expect(eventTimeLabel({ allDay: false, time: "15:00", date: "2026-08-10" })).toBe("3:00 PM");
    /* An end time on a single day reads as a duration. */
    expect(
      eventTimeLabel({ allDay: false, time: "15:00", endTime: "16:30", date: "2026-08-10" }),
    ).toBe("3:00 PM – 4:30 PM");
  });

  test("eventSpanLabel numbers the day within the run", () => {
    expect(eventSpanLabel(day(0, 1))).toBe("");
    expect(eventSpanLabel(day(1, 4))).toBe("Day 2 of 4");
  });
});

describe("reminder targets", () => {
  /** Timed schedule event with reminders on. */
  function schedule(partial: Partial<ScheduleEvent> = {}): ScheduleEvent {
    return {
      date: "2026-08-10",
      allDay: false,
      time: "15:00",
      repeat: "once",
      lead: "1h",
      ...partial,
    };
  }

  /** Targets as "<day>/<kind>" for readable assertions. */
  function shape(ev: ScheduleEvent, now: Date) {
    return reminderTargets(ev, now, TZ).map((t) => `${t.dayIso}/${t.kind}`);
  }

  const NOW = new Date("2026-08-10T00:00:00Z");

  test("a single-day event with a lead produces the lead target plus the always-on at-event target", () => {
    expect(shape(schedule(), NOW)).toEqual(["2026-08-10/lead", "2026-08-10/lead"]);
  });

  test("a multi-day run adds a 09:00 target for every day it is running", () => {
    expect(shape(schedule({ endDate: "2026-08-13" }), NOW)).toEqual([
      "2026-08-10/lead",
      "2026-08-10/lead",
      "2026-08-10/ongoing",
      "2026-08-11/ongoing",
      "2026-08-12/ongoing",
      "2026-08-13/ongoing",
    ]);
  });

  test("the closing day is skipped when the event ends before 09:00", () => {
    expect(shape(schedule({ endDate: "2026-08-13", endTime: "08:30" }), NOW)).toEqual([
      "2026-08-10/lead",
      "2026-08-10/lead",
      "2026-08-10/ongoing",
      "2026-08-11/ongoing",
      "2026-08-12/ongoing",
    ]);
  });

  test("an end time at or after 09:00 keeps the closing day", () => {
    expect(shape(schedule({ endDate: "2026-08-13", endTime: "11:00" }), NOW)).toContain(
      "2026-08-13/ongoing",
    );
  });

  test("with no end time the closing day is covered whole and still reminds", () => {
    expect(shape(schedule({ endDate: "2026-08-13", endTime: null }), NOW)).toContain(
      "2026-08-13/ongoing",
    );
  });

  test("an all-day event with an 'at' lead does not send twice at 09:00", () => {
    const targets = reminderTargets(
      schedule({ allDay: true, time: null, lead: "at", endDate: "2026-08-12" }),
      NOW,
      TZ,
    );
    const startDay = targets.filter((t) => t.dayIso === "2026-08-10");

    expect(startDay).toHaveLength(1);
    expect(startDay[0]!.kind).toBe("lead");
  });

  test("ongoing sends log under a distinct key so they never collide with the lead send", () => {
    const targets = reminderTargets(schedule({ endDate: "2026-08-11" }), NOW, TZ);
    const startDay = targets.filter((t) => t.dayIso === "2026-08-10");

    expect(startDay.map((t) => t.logLead)).toEqual(["1h", "at", "span"]);
  });

  test("every target carries the occurrence start, so content stays run-scoped", () => {
    const targets = reminderTargets(schedule({ endDate: "2026-08-13" }), NOW, TZ);

    expect(new Set(targets.map((t) => t.occurrenceIso))).toEqual(new Set(["2026-08-10"]));
  });
});
