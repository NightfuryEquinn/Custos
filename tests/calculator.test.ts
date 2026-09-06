import { describe, expect, test } from "bun:test";
import {
  allocateBudgets,
  budgetsFromAmounts,
  computeNet,
  isValidAllocationAmounts,
  isValidAllocationTotal,
  isValidTaxTotal,
  MY_TAX_PRESETS,
  percentsFromAmounts,
  sumPercents,
} from "@/frontend/lib/calculator";

describe("calculator", () => {
  test("sumPercents ignores non-finite values", () => {
    expect(sumPercents([10, NaN, 5, Infinity])).toBe(15);
  });

  test("computeNet deducts combined tax from gross", () => {
    expect(computeNet(1000, [10, 5])).toBe(850);
    expect(computeNet(1000, [])).toBe(1000);
    expect(computeNet(-50, [10])).toBe(0);
  });

  test("computeNet clamps tax sum above 100% to zero net", () => {
    expect(computeNet(1000, [60, 50])).toBe(0);
  });

  test("isValidTaxTotal rejects over 100%", () => {
    expect(isValidTaxTotal([10, 20])).toBe(true);
    expect(isValidTaxTotal([100])).toBe(true);
    expect(isValidTaxTotal([60, 50])).toBe(false);
  });

  test("isValidAllocationTotal requires ~100%", () => {
    expect(isValidAllocationTotal([50, 50])).toBe(true);
    expect(isValidAllocationTotal([33.33, 33.33, 33.34])).toBe(true);
    expect(isValidAllocationTotal([40, 40])).toBe(false);
  });

  test("allocateBudgets splits to the cent and places remainder on last positive pct", () => {
    const result = allocateBudgets(100, [
      { id: "a", pct: 33.33 },
      { id: "b", pct: 33.33 },
      { id: "c", pct: 33.34 },
    ]);

    expect((result.a ?? 0) + (result.b ?? 0) + (result.c ?? 0)).toBeCloseTo(100, 6);
    expect(result).toEqual({ a: 33.33, b: 33.33, c: 33.34 });
  });

  test("allocateBudgets keeps 2 decimal places on a fractional net", () => {
    const result = allocateBudgets(100.55, [
      { id: "a", pct: 50 },
      { id: "b", pct: 50 },
    ]);

    expect((result.a ?? 0) + (result.b ?? 0)).toBeCloseTo(100.55, 6);
    expect(result).toEqual({ a: 50.28, b: 50.27 });
  });

  test("allocateBudgets skips zero-pct categories for remainder", () => {
    const result = allocateBudgets(101, [
      { id: "a", pct: 50 },
      { id: "b", pct: 50 },
      { id: "c", pct: 0 },
    ]);

    expect((result.a ?? 0) + (result.b ?? 0) + (result.c ?? 0)).toBe(101);
    expect(result.c).toBe(0);
  });

  test("allocateBudgets returns empty map for empty allocations", () => {
    expect(allocateBudgets(500, [])).toEqual({});
  });

  test("MY_TAX_PRESETS stay within a valid combined tax total", () => {
    expect(MY_TAX_PRESETS.length).toBeGreaterThan(0);
    for (const preset of MY_TAX_PRESETS) {
      expect(isValidTaxTotal(preset.lines.map((l) => l.pct))).toBe(true);
      expect(preset.lines.every((l) => l.title.trim().length > 0)).toBe(true);
    }
  });

  test("isValidAllocationAmounts accepts totals within 1 cent of net", () => {
    expect(isValidAllocationAmounts([40, 60], 100)).toBe(true);
    expect(isValidAllocationAmounts([50.01, 50], 100)).toBe(true);
    expect(isValidAllocationAmounts([49.99, 50], 100)).toBe(true);
  });

  test("isValidAllocationAmounts rejects totals more than 1 cent off", () => {
    expect(isValidAllocationAmounts([40, 40], 100)).toBe(false);
    expect(isValidAllocationAmounts([50.02, 50], 100)).toBe(false);
  });

  test("isValidAllocationAmounts treats empty net as zero target", () => {
    expect(isValidAllocationAmounts([0, 0], 0)).toBe(true);
    expect(isValidAllocationAmounts([10], 0)).toBe(false);
  });

  test("budgetsFromAmounts places remainder on last positive amount", () => {
    const result = budgetsFromAmounts(100, [
      { id: "a", amount: 33.33 },
      { id: "b", amount: 33.33 },
      { id: "c", amount: 33.33 },
    ]);

    expect((result.a ?? 0) + (result.b ?? 0) + (result.c ?? 0)).toBeCloseTo(100, 6);
    expect(result).toEqual({ a: 33.33, b: 33.33, c: 33.34 });
  });

  test("budgetsFromAmounts skips zero-amount categories for remainder", () => {
    const result = budgetsFromAmounts(100.01, [
      { id: "a", amount: 50 },
      { id: "b", amount: 50 },
      { id: "c", amount: 0 },
    ]);

    expect((result.a ?? 0) + (result.b ?? 0) + (result.c ?? 0)).toBeCloseTo(100.01, 6);
    expect(result.c).toBe(0);
    expect(result.b).toBe(50.01);
  });

  test("budgetsFromAmounts returns empty map for empty rows", () => {
    expect(budgetsFromAmounts(500, [])).toEqual({});
  });

  test("percentsFromAmounts round-trips through allocateBudgets", () => {
    const net = 100.55;
    const rows = [
      { id: "a", amount: 50.28 },
      { id: "b", amount: 50.27 },
    ];
    const pcts = percentsFromAmounts(net, rows);
    const back = allocateBudgets(net, [
      { id: "a", pct: pcts.a ?? 0 },
      { id: "b", pct: pcts.b ?? 0 },
    ]);

    expect(isValidAllocationTotal(Object.values(pcts))).toBe(true);
    expect(back).toEqual({ a: 50.28, b: 50.27 });
  });
});
