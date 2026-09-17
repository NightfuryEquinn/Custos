import { createApiApp } from "@/api/app";
import { describe, expect, test } from "bun:test";
import { createWallet, signIn } from "../helpers/api-client";
import { useMemoryDb } from "../helpers/memory-db";

const app = createApiApp();

async function createPlan(cookie: string): Promise<string> {
  const res = await app.request("/api/capital-plans", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ enc: 1, payload: "plan-ciphertext" }),
  });
  expect(res.status).toBe(201);
  const { capitalPlan } = (await res.json()) as { capitalPlan: { id: string } };

  return capitalPlan.id;
}

async function createExpense(
  cookie: string,
  walletId: string,
  capitalPlanId?: string,
): Promise<string> {
  const res = await app.request("/api/expenses", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({
      walletId,
      date: "2026-08-01",
      enc: 1,
      payload: "expense-ciphertext",
      ...(capitalPlanId ? { capitalPlanId } : {}),
    }),
  });
  expect(res.status).toBe(201);
  const { expense } = (await res.json()) as { expense: { id: string } };

  return expense.id;
}

/** Read one expense's capitalPlanId back through the API, as a client would. */
async function planIdOf(cookie: string, expenseId: string): Promise<string | undefined> {
  const res = await app.request("/api/expenses", { headers: { cookie } });
  const { expenses } = (await res.json()) as {
    expenses: { id: string; capitalPlanId?: string }[];
  };
  const found = expenses.find((e) => e.id === expenseId);
  expect(found).toBeDefined();

  return found!.capitalPlanId;
}

describe("capital plan routes", () => {
  const getMemory = useMemoryDb();

  test("deleting a plan releases the savings assigned to it", async () => {
    const cookie = await signIn(app);
    const walletId = await createWallet(app, cookie);
    const planId = await createPlan(cookie);
    const assigned = await createExpense(cookie, walletId, planId);

    expect(await planIdOf(cookie, assigned)).toBe(planId);

    const res = await app.request(`/api/capital-plans/${planId}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(res.status).toBe(200);

    // Released, not deleted — the deposit is real money and goes back to its
    // savings envelope rather than vanishing from both trackers.
    expect(await planIdOf(cookie, assigned)).toBeUndefined();
  });

  test("leaves other plans' and unassigned expenses alone", async () => {
    const cookie = await signIn(app);
    const walletId = await createWallet(app, cookie);
    const doomed = await createPlan(cookie);
    const keeper = await createPlan(cookie);

    const onDoomed = await createExpense(cookie, walletId, doomed);
    const onKeeper = await createExpense(cookie, walletId, keeper);
    const unassigned = await createExpense(cookie, walletId);

    await app.request(`/api/capital-plans/${doomed}`, { method: "DELETE", headers: { cookie } });

    expect(await planIdOf(cookie, onDoomed)).toBeUndefined();
    expect(await planIdOf(cookie, onKeeper)).toBe(keeper);
    expect(await planIdOf(cookie, unassigned)).toBeUndefined();
  });

  test("releases a legacy hex-string capitalPlanId too", async () => {
    const cookie = await signIn(app);
    const walletId = await createWallet(app, cookie);
    const planId = await createPlan(cookie);
    const legacy = await createExpense(cookie, walletId, planId);

    // Rows predating the ObjectId write path store the id as a hex string; an
    // ObjectId-only filter would skip exactly the rows this cleanup exists for.
    const docs = getMemory().collection("expenses")._docs as {
      _id: unknown;
      capitalPlanId?: unknown;
    }[];
    const doc = docs.find((d) => String(d._id) === legacy)!;
    doc.capitalPlanId = planId;

    await app.request(`/api/capital-plans/${planId}`, { method: "DELETE", headers: { cookie } });

    expect(await planIdOf(cookie, legacy)).toBeUndefined();
  });

  test("another account cannot delete the plan or release its savings", async () => {
    const owner = await signIn(app);
    const walletId = await createWallet(app, owner);
    const planId = await createPlan(owner);
    const assigned = await createExpense(owner, walletId, planId);

    const stranger = await signIn(app);
    const res = await app.request(`/api/capital-plans/${planId}`, {
      method: "DELETE",
      headers: { cookie: stranger },
    });
    expect(res.status).toBe(404);

    expect(await planIdOf(owner, assigned)).toBe(planId);
  });
});
