import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemeProvider } from "@/frontend/lib/hooks/useTheme";
import { buildCategoryIndex } from "@/frontend/lib/categories";
import { DEFAULT_CATEGORIES } from "@/schemas/category";

test("the journal renders real ledger data and keeps every analysis section reachable", async () => {
  // Other hook tests leave a partial window shim; SSR must run without it.
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Reflect.deleteProperty(globalThis, "window");
  try {
    const { Overview } = await import("@/frontend/views");
    const categories = DEFAULT_CATEGORIES.map((category) => ({
      ...category,
      subs: category.subs.map((sub) => ({ ...sub })),
    }));
    const categoryIndex = buildCategoryIndex(categories);
    const sub = categories.find(
      (category) => category.type !== "income" && category.type !== "savings",
    )!.subs[0]!.id;
    const html = renderToStaticMarkup(
      <ThemeProvider>
        <Overview
          expenses={[
            {
              id: "expense-1",
              walletId: "wallet-1",
              kind: "expense",
              date: "2026-10-01",
              sub,
              amount: 12,
              note: "Morning coffee",
              recurring: false,
            },
          ]}
          budgets={{}}
          wallet={{
            id: "wallet-1",
            name: "Everyday",
            currency: "USD",
            fundingMode: "monthly",
            income: 3000,
            startingBalance: 0,
            budgets: {},
            isDefault: true,
          }}
          month="2026-10"
          currency="USD"
          categoryIndex={categoryIndex}
          setView={() => {}}
          onEdit={() => {}}
          onEditEvent={() => {}}
        />
      </ThemeProvider>,
    );
    expect(html).toContain("Morning coffee");
    expect(html).toContain("Total (USD)");
    expect(html).not.toContain("Total (RM)");
    expect(html).toContain("Money in motion");
    expect(html).toContain("Just ahead");
    expect(html).toContain('data-tour="tour-overview-donut"');
    expect(html).toContain('data-tour="tour-overview-trend"');
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
  }
});
