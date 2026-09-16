import { resolveNav } from "@/frontend/lib/nav";
import { DEFAULT_TAB_IDS, VIEW_IDS } from "@/lib/views";
import { describe, expect, test } from "bun:test";

function ids(items: { 0: string }[]): string[] {
  return items.map((item) => item[0]);
}

describe("resolveNav", () => {
  test("with no stored prefs, falls back to the built-in defaults", () => {
    const { sidebarItems, tabItems, moreItems } = resolveNav(undefined, undefined);
    const defaultTabSet = new Set<string>(DEFAULT_TAB_IDS);

    expect(ids(sidebarItems)).toEqual([...VIEW_IDS]);
    expect(ids(tabItems)).toEqual([...DEFAULT_TAB_IDS]);
    expect(ids(moreItems)).toEqual(VIEW_IDS.filter((id) => !defaultTabSet.has(id)));
  });

  test("drops an id that is no longer a real view", () => {
    const { sidebarItems } = resolveNav(["overview", "not-a-real-view", "schedule"], undefined);

    expect(ids(sidebarItems)).not.toContain("not-a-real-view");
    expect(ids(sidebarItems)).toEqual(expect.arrayContaining(["overview", "schedule"]));
  });

  test("a view missing from a stored order is appended, not dropped", () => {
    const partial = VIEW_IDS.filter((id) => id !== "transparency");
    const { sidebarItems } = resolveNav(partial, undefined);

    expect(ids(sidebarItems)).toContain("transparency");
    expect(ids(sidebarItems)).toHaveLength(VIEW_IDS.length);
  });

  test("de-dupes a stored order with a repeated id", () => {
    const { sidebarItems } = resolveNav(["overview", "overview", "schedule"], undefined);

    expect(ids(sidebarItems).filter((id) => id === "overview")).toHaveLength(1);
  });

  test("fewer than four valid tabs falls back to the defaults", () => {
    const { tabItems } = resolveNav(undefined, ["overview", "schedule"]);

    expect(ids(tabItems)).toEqual([...DEFAULT_TAB_IDS]);
  });

  test("a custom four-tab pick is honored in order", () => {
    const picks = ["budgets", "piggies", "insights", "overview"];
    const { tabItems } = resolveNav(undefined, picks);

    expect(ids(tabItems)).toEqual(picks);
  });

  test("moreItems is always sidebarItems minus tabItems", () => {
    const picks = ["budgets", "piggies", "insights", "overview"];
    const { sidebarItems, tabItems, moreItems } = resolveNav(undefined, picks);

    const tabIdSet = new Set(ids(tabItems));
    expect(ids(moreItems)).toEqual(ids(sidebarItems).filter((id) => !tabIdSet.has(id)));
  });
});
