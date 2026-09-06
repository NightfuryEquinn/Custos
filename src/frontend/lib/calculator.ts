/**
 * Budget calculator helpers — tax deduction and category allocation.
 * Client-side only; no persistence. Allocation can be by percentage or
 * by explicit amounts that must total net after tax.
 */

type AllocationRow = {
  id: string;
  pct: number;
};

type AmountRow = {
  id: string;
  amount: number;
};

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

/** Whether allocation percentages total approximately 100%. */
export function isValidAllocationTotal(percents: number[]): boolean {
  return Math.abs(sumPercents(percents) - 100) <= PCT_TOLERANCE;
}

/**
 * Net income after a single combined tax deduction:
 * `gross * (1 - Σtax%/100)`. Returns 0 when gross is negative.
 */
export function computeNet(gross: number, taxPercents: number[]): number {
  if (!Number.isFinite(gross) || gross < 0) {
    return 0;
  }

  const taxSum = sumPercents(taxPercents);
  const clamped = Math.min(Math.max(taxSum, 0), 100);

  return gross * (1 - clamped / 100);
}

/**
 * Allocate net across categories by percentage.
 * Amounts carry 2 decimal places; the split is computed in whole cents so
 * any rounding remainder goes to the last category with a positive
 * percentage and the map totals net rounded to the nearest cent.
 */
export function allocateBudgets(net: number, allocations: AllocationRow[]): Record<string, number> {
  const targetCents = Math.max(0, Math.round((Number.isFinite(net) ? net : 0) * 100));
  const centsById: Record<string, number> = {};

  if (!allocations.length) {
    return {};
  }

  let allocated = 0;

  for (const row of allocations) {
    const pct = Number.isFinite(row.pct) ? Math.max(0, row.pct) : 0;
    const cents = Math.round((targetCents * pct) / 100);
    centsById[row.id] = cents;
    allocated += cents;
  }

  const remainder = targetCents - allocated;

  if (remainder !== 0) {
    for (let i = allocations.length - 1; i >= 0; i--) {
      const row = allocations[i];

      if (!row) continue;

      const pct = Number.isFinite(row.pct) ? row.pct : 0;

      if (pct > 0) {
        centsById[row.id] = (centsById[row.id] ?? 0) + remainder;
        break;
      }
    }
  }

  const result: Record<string, number> = {};

  for (const [id, cents] of Object.entries(centsById)) {
    result[id] = cents / 100;
  }

  return result;
}

/**
 * Whether allocation amounts total net within one cent.
 * Non-finite and negative values are treated as 0.
 */
export function isValidAllocationAmounts(amounts: number[], net: number): boolean {
  const targetCents = Math.max(0, Math.round((Number.isFinite(net) ? net : 0) * 100));
  const sumCents = amounts.reduce((sum, amount) => {
    const cents = Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0;

    return sum + cents;
  }, 0);

  return Math.abs(sumCents - targetCents) <= CENT_TOLERANCE;
}

/**
 * Build budgets from explicit amounts. Amounts carry 2 decimal places;
 * leftover cents (from rounding or 1-cent slack) go to the last category
 * with a positive amount so the map totals net rounded to the nearest cent.
 */
export function budgetsFromAmounts(net: number, rows: AmountRow[]): Record<string, number> {
  const targetCents = Math.max(0, Math.round((Number.isFinite(net) ? net : 0) * 100));
  const centsById: Record<string, number> = {};

  if (!rows.length) {
    return {};
  }

  let allocated = 0;

  for (const row of rows) {
    const cents = Number.isFinite(row.amount) && row.amount > 0 ? Math.round(row.amount * 100) : 0;
    centsById[row.id] = cents;
    allocated += cents;
  }

  const remainder = targetCents - allocated;

  if (remainder !== 0) {
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];

      if (!row) continue;

      const amount = Number.isFinite(row.amount) ? row.amount : 0;

      if (amount > 0) {
        centsById[row.id] = (centsById[row.id] ?? 0) + remainder;
        break;
      }
    }
  }

  const result: Record<string, number> = {};

  for (const [id, cents] of Object.entries(centsById)) {
    result[id] = cents / 100;
  }

  return result;
}

/**
 * Convert amounts into percentages that total 100% (2 decimal places).
 * Remainder hundredths go to the last category with a positive amount.
 * Returns 0% for every row when net is 0.
 */
export function percentsFromAmounts(net: number, rows: AmountRow[]): Record<string, number> {
  const targetCents = Math.max(0, Math.round((Number.isFinite(net) ? net : 0) * 100));
  const result: Record<string, number> = {};

  if (!rows.length) {
    return {};
  }

  if (targetCents === 0) {
    for (const row of rows) {
      result[row.id] = 0;
    }

    return result;
  }

  const hundredthsById: Record<string, number> = {};
  let allocated = 0;

  for (const row of rows) {
    const cents = Number.isFinite(row.amount) && row.amount > 0 ? Math.round(row.amount * 100) : 0;
    const hundredths = Math.round((cents * 10000) / targetCents);
    hundredthsById[row.id] = hundredths;
    allocated += hundredths;
  }

  const remainder = 10000 - allocated;

  if (remainder !== 0) {
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];

      if (!row) continue;

      const amount = Number.isFinite(row.amount) ? row.amount : 0;

      if (amount > 0) {
        hundredthsById[row.id] = (hundredthsById[row.id] ?? 0) + remainder;
        break;
      }
    }
  }

  for (const [id, hundredths] of Object.entries(hundredthsById)) {
    result[id] = hundredths / 100;
  }

  return result;
}
