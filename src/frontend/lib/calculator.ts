/**
 * Budget calculator helpers — tax deduction (percentage and fixed-amount
 * lines) and category allocation.
 * Client-side only; no persistence. Allocation is by explicit amount per
 * category, up to (but not required to reach) net after tax.
 */

import type { FinancialWallet, SubcategoryBudgets } from "./types";

export type TaxPresetLine = {
  title: string;
  pct: number;
};

export type TaxPreset = {
  id: string;
  label: string;
  description: string;
  lines: TaxPresetLine[];
};

/**
 * Malaysia-oriented payroll / tax preset packs (approximate employee-side %).
 * Estimates only — not official LHDN/EPF advice; all math stays in-browser.
 */
export const MY_TAX_PRESETS: TaxPreset[] = [
  {
    id: "my-epf-employee",
    label: "MY · EPF employee (11%)",
    description: "Employee EPF contribution at 11%.",
    lines: [{ title: "EPF (employee)", pct: 11 }],
  },
  {
    id: "my-socso-employee",
    label: "MY · SOCSO employee (0.5%)",
    description: "Employee SOCSO contribution (approx.).",
    lines: [{ title: "SOCSO (employee)", pct: 0.5 }],
  },
  {
    id: "my-eis-employee",
    label: "MY · EIS employee (0.2%)",
    description: "Employee EIS contribution (approx.).",
    lines: [{ title: "EIS (employee)", pct: 0.2 }],
  },
  {
    id: "my-pcb-ballpark",
    label: "MY · PCB ballpark (10%)",
    description: "Rough PCB withholding placeholder — adjust to your payslip.",
    lines: [{ title: "PCB (estimate)", pct: 10 }],
  },
  {
    id: "my-sst",
    label: "MY · SST (6%)",
    description: "Service tax style line for taxable spend planning.",
    lines: [{ title: "SST", pct: 6 }],
  },
];

const PCT_TOLERANCE = 0.01;
const CENT_TOLERANCE = 1;

/** Sum finite percentage values (non-finite treated as 0). */
export function sumPercents(percents: number[]): number {
  return percents.reduce((sum, p) => sum + (Number.isFinite(p) ? p : 0), 0);
}

/** Whether tax percentages total at most 100%. */
export function isValidTaxTotal(taxPercents: number[]): boolean {
  return sumPercents(taxPercents) <= 100 + PCT_TOLERANCE;
}

export type TaxLineInput = {
  /** `pct` is a share of gross; `fixed` is a flat amount in the wallet currency. */
  mode: "pct" | "fixed";
  value: number;
};

/**
 * Tax and net for a set of deduction lines. Percentages apply to gross and
 * fixed amounts are subtracted as-is; non-finite or negative values count as 0
 * and the total is capped at gross, so net never goes below 0. Returns zeros
 * when gross is negative or not finite.
 */
export function computeTax(
  gross: number,
  lines: TaxLineInput[],
): { pctSum: number; fixedSum: number; taxAmount: number; net: number } {
  const pctSum = sumPercents(lines.filter((l) => l.mode === "pct").map((l) => l.value));
  const fixedSum = lines
    .filter((l) => l.mode === "fixed")
    .reduce((sum, l) => sum + (Number.isFinite(l.value) && l.value > 0 ? l.value : 0), 0);

  if (!Number.isFinite(gross) || gross < 0) return { pctSum, fixedSum, taxAmount: 0, net: 0 };

  const pctTax = gross * (Math.min(Math.max(pctSum, 0), 100) / 100);
  const taxAmount = Math.min(gross, pctTax + fixedSum);

  return { pctSum, fixedSum, taxAmount, net: gross - taxAmount };
}

/**
 * Whether the lines can be deducted from `gross`: percentages total at most
 * 100% and the combined tax does not exceed gross (1-cent tolerance). With no
 * gross entered yet only the percentage total is checked, so typing a fixed
 * amount first does not raise a warning.
 */
export function isValidTaxLines(gross: number, lines: TaxLineInput[]): boolean {
  const { pctSum, fixedSum } = computeTax(gross, lines);

  if (!isValidTaxTotal([pctSum])) return false;
  if (!(gross > 0)) return true;

  return (gross * pctSum) / 100 + fixedSum <= gross + CENT_TOLERANCE / 100;
}

/**
 * Whether allocation amounts total at most net, within a 1-cent tolerance.
 * Non-finite and negative values are treated as 0.
 */
export function isValidAllocationAmounts(amounts: number[], net: number): boolean {
  const targetCents = Math.max(0, Math.round((Number.isFinite(net) ? net : 0) * 100));
  const sumCents = amounts.reduce((sum, amount) => {
    const cents = Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0;

    return sum + cents;
  }, 0);

  return sumCents <= targetCents + CENT_TOLERANCE;
}

/**
 * Replace active parent budgets from subcategory allocations already rounded to cents.
 * A ceiling at least as large as the subcategory sum becomes the parent budget.
 * When the ceiling is omitted, the parent is the subcategory sum.
 * A zero ceiling and a zero breakdown clear both. Ceilings below the breakdown
 * are listed in `overCategoryIds` and leave that category unchanged.
 */
export function replaceBudgetAllocations(
  current: Pick<FinancialWallet, "budgets" | "subcategoryBudgets">,
  allocations: SubcategoryBudgets,
  ceilings?: Record<string, number | undefined>,
) {
  const budgets = { ...current.budgets };
  const subcategoryBudgets = { ...current.subcategoryBudgets };
  const overCategoryIds: string[] = [];
  const amountRows = Object.entries(allocations).map(([id, breakdown]) => {
    const cents = Object.values(breakdown).reduce(
      (sum, amount) => sum + (Number.isFinite(amount) ? Math.round(amount * 100) : 0),
      0,
    );
    const explicit = ceilings?.[id];
    const hasCeiling = explicit !== undefined && Number.isFinite(explicit);
    const ceilingCents = hasCeiling ? Math.round(explicit * 100) : cents;

    if (hasCeiling && ceilingCents < cents) {
      overCategoryIds.push(id);

      return { id, amount: ceilingCents / 100 };
    }

    const amount = ceilingCents / 100;

    if (amount > 0) {
      budgets[id] = amount;
      subcategoryBudgets[id] = breakdown;
    } else {
      delete budgets[id];
      delete subcategoryBudgets[id];
    }

    return { id, amount };
  });

  return { budgets, subcategoryBudgets, amountRows, overCategoryIds };
}
