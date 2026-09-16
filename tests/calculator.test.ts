import { describe, expect, test } from "bun:test";
import {
  budgetsFromAmounts,
  computeNet,
  isValidAllocationAmounts,
  isValidTaxTotal,
  MY_TAX_PRESETS,
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

  test("MY_TAX_PRESETS stay within a valid combined tax total", () => {
    expect(MY_TAX_PRESETS.length).toBeGreaterThan(0);
    for (const preset of MY_TAX_PRESETS) {
      expect(isValidTaxTotal(preset.lines.map((l) => l.pct))).toBe(true);
      expect(preset.lines.every((l) => l.title.trim().length > 0)).toBe(true);
    }
  });

  test("isValidAllocationAmounts accepts totals at or under net", () => {
    expect(isValidAllocationAmounts([40, 60], 100)).toBe(true);
    expect(isValidAllocationAmounts([50.01, 50], 100)).toBe(true);
    expect(isValidAllocationAmounts([40, 40], 100)).toBe(true);
  });

  test("isValidAllocationAmounts rejects totals more than 1 cent over net", () => {
    expect(isValidAllocationAmounts([50.02, 50], 100)).toBe(false);
  });

  test("isValidAllocationAmounts treats empty net as zero target", () => {
    expect(isValidAllocationAmounts([0, 0], 0)).toBe(true);
    expect(isValidAllocationAmounts([10], 0)).toBe(false);
  });

  test("budgetsFromAmounts applies entered amounts verbatim, no redistribution", () => {
    const result = budgetsFromAmounts([
      { id: "a", amount: 33.33 },
      { id: "b", amount: 33.33 },
      { id: "c", amount: 33.33 },
    ]);

    expect(result).toEqual({ a: 33.33, b: 33.33, c: 33.33 });
  });

  test("budgetsFromAmounts omits zero/blank categories entirely", () => {
    const result = budgetsFromAmounts([
      { id: "a", amount: 50 },
      { id: "b", amount: 0 },
    ]);

    expect(result).toEqual({ a: 50 });
    expect(result.b).toBeUndefined();
  });

  test("budgetsFromAmounts returns empty map for empty rows", () => {
    expect(budgetsFromAmounts([])).toEqual({});
  });
});
