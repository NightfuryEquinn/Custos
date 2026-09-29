import { describe, expect, test } from "bun:test";
import {
  budgetsFromAmounts,
  computeTax,
  isValidAllocationAmounts,
  isValidTaxLines,
  isValidTaxTotal,
  MY_TAX_PRESETS,
  sumPercents,
} from "@/frontend/lib/calculator";

describe("calculator", () => {
  test("sumPercents ignores non-finite values", () => {
    expect(sumPercents([10, NaN, 5, Infinity])).toBe(15);
  });

  const pct = (value: number) => ({ mode: "pct" as const, value });
  const fixed = (value: number) => ({ mode: "fixed" as const, value });

  test("computeTax deducts percentage lines from gross", () => {
    expect(computeTax(1000, [pct(10), pct(5)])).toMatchObject({ taxAmount: 150, net: 850 });
    expect(computeTax(1000, [])).toMatchObject({ taxAmount: 0, net: 1000 });
    expect(computeTax(-50, [pct(10)])).toMatchObject({ taxAmount: 0, net: 0 });
  });

  test("computeTax subtracts fixed lines as-is", () => {
    expect(computeTax(1000, [fixed(50), fixed(25)])).toMatchObject({
      fixedSum: 75,
      taxAmount: 75,
      net: 925,
    });
  });

  test("computeTax mixes percentage and fixed lines, both off gross", () => {
    expect(computeTax(1000, [pct(11), fixed(50)])).toEqual({
      pctSum: 11,
      fixedSum: 50,
      taxAmount: 160,
      net: 840,
    });
  });

  test("computeTax ignores negative and non-finite values", () => {
    expect(computeTax(1000, [fixed(-20), fixed(NaN), pct(NaN)])).toMatchObject({
      taxAmount: 0,
      net: 1000,
    });
  });

  test("computeTax caps tax at gross so net never goes below zero", () => {
    expect(computeTax(1000, [pct(60), pct(50)])).toMatchObject({ taxAmount: 1000, net: 0 });
    expect(computeTax(100, [fixed(150)])).toMatchObject({ taxAmount: 100, net: 0 });
  });

  test("isValidTaxLines rejects percentages over 100% and tax over gross", () => {
    expect(isValidTaxLines(1000, [pct(60), pct(40)])).toBe(true);
    expect(isValidTaxLines(1000, [pct(60), pct(50)])).toBe(false);
    expect(isValidTaxLines(1000, [pct(50), fixed(500)])).toBe(true);
    expect(isValidTaxLines(1000, [pct(50), fixed(500.02)])).toBe(false);
    expect(isValidTaxLines(100, [fixed(150)])).toBe(false);
  });

  test("isValidTaxLines does not flag a fixed line before any gross is entered", () => {
    expect(isValidTaxLines(0, [fixed(50)])).toBe(true);
    expect(isValidTaxLines(0, [pct(150)])).toBe(false);
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
