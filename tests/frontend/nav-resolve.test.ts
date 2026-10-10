import { NAV_GROUPS, VIEW_CONTROLS, resolveNav } from "@/frontend/lib/nav";
import { DEFAULT_TAB_IDS, VIEW_IDS } from "@/lib/views";
import { describe, expect, test } from "bun:test";

function ids(items: { 0: string }[]): string[] {
  return items.map((item) => item[0]);
}

describe("resolveNav", () => {
  test("with no stored prefs, falls back to the built-in defaults", () => {
    const { sidebarItems, tabItems } = resolveNav(undefined, undefined);

    expect(ids(sidebarItems)).toEqual(
      NAV_GROUPS.flatMap(([, groupIds]) => groupIds).filter((id) => VIEW_IDS.includes(id as never)),
    );
    expect(ids(tabItems)).toEqual([...DEFAULT_TAB_IDS]);
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

  test("every view belongs to exactly one group", () => {
    const all = NAV_GROUPS.flatMap(([, groupIds]) => groupIds);

    expect(new Set(all).size).toBe(all.length);
    for (const id of VIEW_IDS) expect(all).toContain(id);
  });

  test("a saved order applies within its group", () => {
    const { groups } = resolveNav(["insights", "transactions"], undefined);
    const money = groups.find((g) => g.label === "Money")!;

    expect(ids(money.items).slice(0, 2)).toEqual(["insights", "transactions"]);
  });

  test("a view the saved order never mentions keeps its group's default slot", () => {
    const { groups } = resolveNav(["budgets"], undefined);
    const money = groups.find((g) => g.label === "Money")!;

    expect(ids(money.items)[0]).toBe("budgets");
    expect(ids(money.items)).toContain("transactions");
    expect(ids(money.items)).toHaveLength(NAV_GROUPS.find(([l]) => l === "Money")![1].length);
  });

  test("favorites plus the More groups cover every view exactly once", () => {
    const picks = ["budgets", "piggies", "insights", "overview"];
    const { tabItems, moreGroups } = resolveNav(undefined, picks);
    const covered = [...ids(tabItems), ...moreGroups.flatMap((g) => ids(g.items))];

    expect(new Set(covered).size).toBe(covered.length);
    expect(covered.sort()).toEqual([...VIEW_IDS].sort());
    for (const g of moreGroups) expect(g.items.length).toBeGreaterThan(0);
  });
});

describe("header controls per page", () => {
  test("Daily and To-do never inherit wallet or month filters", () => {
    expect(VIEW_CONTROLS.daily).toBeUndefined();
    expect(VIEW_CONTROLS.todos).toBeUndefined();
  });

  test("pages whose numbers depend on the active wallet keep the wallet switcher", () => {
    // Savings and Big Expenses read the active wallet's savings; Vehicles formats in its currency.
    for (const id of ["piggies", "capitals", "vehicles", "overview", "transactions"] as const)
      expect(VIEW_CONTROLS[id]).toContain("w");
  });

  test("month-scoped pages keep the month switcher", () => {
    for (const id of ["overview", "schedule", "piggies", "insights"] as const)
      expect(VIEW_CONTROLS[id]).toContain("m");
  });
});
