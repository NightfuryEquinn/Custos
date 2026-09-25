import { describe, expect, test } from "bun:test";
import { evaluateExpression, isPlainNumber } from "@/frontend/lib/arithmetic";

describe("evaluateExpression", () => {
  test("evaluates a plain number", () => {
    expect(evaluateExpression("42")).toBe(42);
  });

  test("respects operator precedence", () => {
    expect(evaluateExpression("12+5.99*2")).toBeCloseTo(23.98);
  });

  test("evaluates parentheses before precedence", () => {
    expect(evaluateExpression("(1+2)*3")).toBe(9);
  });

  test("evaluates division", () => {
    expect(evaluateExpression("10/4")).toBe(2.5);
  });

  test("rounds to 2 decimal places", () => {
    expect(evaluateExpression("10/3")).toBe(3.33);
    expect(evaluateExpression("2/3")).toBe(0.67);
  });

  test("handles whitespace between tokens", () => {
    expect(evaluateExpression("1 + 2")).toBe(3);
  });

  test("supports unary minus", () => {
    expect(evaluateExpression("-5+10")).toBe(5);
  });

  test("returns null for a trailing operator", () => {
    expect(evaluateExpression("12+")).toBeNull();
  });

  test("returns null for empty input", () => {
    expect(evaluateExpression("")).toBeNull();
  });

  test("returns null for invalid characters", () => {
    expect(evaluateExpression("12+a")).toBeNull();
  });

  test("returns null for division by zero", () => {
    expect(evaluateExpression("5/0")).toBeNull();
  });

  test("returns null for malformed decimals", () => {
    expect(evaluateExpression("1.2.3")).toBeNull();
  });
});

describe("isPlainNumber", () => {
  test("true for a plain or partial decimal", () => {
    expect(isPlainNumber("42")).toBe(true);
    expect(isPlainNumber("12.")).toBe(true);
    expect(isPlainNumber("")).toBe(true);
  });

  test("false once an operator is present", () => {
    expect(isPlainNumber("12+5")).toBe(false);
  });
});
