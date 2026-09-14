import { describe, expect, test } from "bun:test";
import {
  decodeCategories,
  decodeEvent,
  decodeExpense,
  decodeTodoList,
  decodeWallet,
  encodeCategories,
  encodeEventCreate,
  encodeEventUpdate,
  encodeExpenseCreate,
  encodeTodoListCreate,
  encodeWalletFinancials,
} from "@/frontend/lib/crypto/codec";
import {
  buildDerivationMessage,
  deriveKeyFromSignature,
  deriveSeriesHmacKeyFromSignature,
} from "@/frontend/lib/crypto/e2ee";
import { createEventSchema, updateEventSchema } from "@/schemas/event";
import { Wallet } from "ethers";

/** Derive a test AES key from a random wallet signature. */
async function testKey() {
  const wallet = Wallet.createRandom();
  const signature = await wallet.signMessage(buildDerivationMessage(wallet.address));
  return deriveKeyFromSignature(signature);
}

/** Derive a test series-HMAC key, paired with `testKey`'s AES key. */
async function testSeriesKey() {
  const wallet = Wallet.createRandom();
  const signature = await wallet.signMessage(buildDerivationMessage(wallet.address));
  return deriveSeriesHmacKeyFromSignature(signature);
}

describe("crypto codec", () => {
  test("encodeExpenseCreate encrypts secrets and leaves metadata plaintext", async () => {
    const key = await testKey();
    const seriesKey = await testSeriesKey();
    const wire = await encodeExpenseCreate(
      {
        walletId: "507f1f77bcf86cd799439011",
        kind: "expense",
        date: "2026-07-01",
        sub: "groceries",
        amount: 25,
        note: "fruit",
        recurring: false,
      },
      key,
      seriesKey,
    );
    expect(wire.enc).toBe(1);
    expect(wire.payload).toBeTruthy();
    expect(wire.walletId).toBe("507f1f77bcf86cd799439011");
    expect(wire.date).toBe("2026-07-01");
    expect(wire.kind).toBe("expense");
    expect(wire.recurring).toBe(false);
    expect(wire).not.toHaveProperty("sub");
    expect(wire).not.toHaveProperty("amount");
    expect(wire).not.toHaveProperty("note");
    expect(wire.seriesKey).toBeUndefined();
  });

  test("recurring expenses include a stable seriesKey", async () => {
    const key = await testKey();
    const seriesKey = await testSeriesKey();
    const a = await encodeExpenseCreate(
      {
        walletId: "507f1f77bcf86cd799439011",
        kind: "expense",
        date: "2026-07-01",
        sub: "internet",
        amount: 99,
        note: "fiber",
        recurring: "monthly",
      },
      key,
      seriesKey,
    );
    const b = await encodeExpenseCreate(
      {
        walletId: "507f1f77bcf86cd799439011",
        kind: "expense",
        date: "2026-08-01",
        sub: "internet",
        amount: 99,
        note: "fiber",
        recurring: "monthly",
      },
      key,
      seriesKey,
    );
    expect(a.seriesKey).toMatch(/^[a-f0-9]{64}$/);
    expect(a.seriesKey).toBe(b.seriesKey);
  });

  test("seriesKey is not reproducible from plaintext fields alone (different account, same fields)", async () => {
    const key = await testKey();
    const otherSeriesKey = await testSeriesKey();
    const fields = {
      walletId: "507f1f77bcf86cd799439011",
      kind: "expense" as const,
      date: "2026-07-01",
      sub: "internet",
      amount: 99,
      note: "fiber",
      recurring: "monthly" as const,
    };
    const a = await encodeExpenseCreate(fields, key, await testSeriesKey());
    const b = await encodeExpenseCreate(fields, key, otherSeriesKey);
    /* Same plaintext fields, different account-scoped HMAC keys: the digest
       must differ, unlike the old plain SHA-256 (which anyone who knew the
       fields, including a server, could reproduce without any key at all). */
    expect(a.seriesKey).not.toBe(b.seriesKey);
  });

  test("decodeExpense decrypts enc=1 payloads", async () => {
    const key = await testKey();
    const seriesKey = await testSeriesKey();
    const wire = await encodeExpenseCreate(
      {
        walletId: "507f1f77bcf86cd799439011",
        kind: "expense",
        date: "2026-07-10",
        sub: "meal",
        amount: 18.5,
        note: "lunch",
        recurring: false,
      },
      key,
      seriesKey,
    );
    const decoded = await decodeExpense({ id: "exp1", ...wire }, key);
    expect(decoded).toMatchObject({
      id: "exp1",
      sub: "meal",
      amount: 18.5,
      note: "lunch",
      date: "2026-07-10",
    });
  });

  test("decodeExpense supports legacy plaintext records", async () => {
    const key = await testKey();
    const decoded = await decodeExpense(
      {
        id: "legacy",
        walletId: "w1",
        kind: "expense",
        date: "2026-01-01",
        recurring: false,
        sub: "petrol",
        amount: 40,
        note: "tank",
      },
      key,
    );
    expect(decoded.sub).toBe("petrol");
    expect(decoded.amount).toBe(40);
  });

  test("encodeWalletFinancials encrypts name, budgets and balances", async () => {
    const key = await testKey();
    const wire = await encodeWalletFinancials(
      { name: "Main", income: 5000, startingBalance: 100, budgets: { food: 800, transport: 200 } },
      key,
    );
    expect(wire.enc).toBe(1);
    const decoded = await decodeWallet(
      {
        id: "w1",
        currency: "MYR",
        fundingMode: "monthly",
        isDefault: true,
        ...wire,
      },
      key,
    );
    expect(decoded.name).toBe("Main");
    expect(decoded.income).toBe(5000);
    expect(decoded.startingBalance).toBe(100);
    expect(decoded.budgets).toEqual({ food: 800, transport: 200 });
  });

  test("decodeWallet prefers encrypted name over plaintext leftover", async () => {
    const key = await testKey();
    const wire = await encodeWalletFinancials(
      { name: "Secret", income: 1, startingBalance: 0, budgets: {} },
      key,
    );
    const decoded = await decodeWallet(
      {
        id: "w1",
        name: "Plain leftover",
        currency: "MYR",
        fundingMode: "monthly",
        isDefault: true,
        ...wire,
      },
      key,
    );
    expect(decoded.name).toBe("Secret");
  });

  test("decodeWallet supports legacy plaintext wallets", async () => {
    const key = await testKey();
    const decoded = await decodeWallet(
      {
        id: "w1",
        name: "Cash",
        currency: "USD",
        fundingMode: "starting",
        isDefault: false,
        income: 0,
        startingBalance: 250,
        budgets: { food: 100 },
      },
      key,
    );
    expect(decoded.name).toBe("Cash");
    expect(decoded.startingBalance).toBe(250);
    expect(decoded.budgets.food).toBe(100);
  });

  test("encodeCategories / decodeCategories round-trip", async () => {
    const key = await testKey();
    const categories = [
      {
        id: "food",
        name: "Food",
        color: "#5b7a8a",
        glyph: "🍽️",
        type: "expense" as const,
        builtin: true,
        subs: [{ id: "groceries", name: "Groceries" }],
      },
      {
        id: "income",
        name: "Income",
        color: "#6f8b6f",
        glyph: "💵",
        type: "income" as const,
        builtin: true,
        subs: [{ id: "salary", name: "Salary" }],
      },
    ];
    const wire = await encodeCategories(categories, key);
    expect(wire.enc).toBe(1);
    expect(wire).not.toHaveProperty("categories");
    const decoded = await decodeCategories(wire, key);
    expect(decoded).toEqual(categories);
  });

  test("decodeCategories supports legacy plaintext trees", async () => {
    const key = await testKey();
    const categories = [
      {
        id: "fun",
        name: "Fun",
        color: "#a06f95",
        glyph: "🎬",
        type: "expense" as const,
        subs: [{ id: "games", name: "Games" }],
      },
    ];
    const decoded = await decodeCategories({ categories }, key);
    expect(decoded[0]!.id).toBe("fun");
  });

  test("encodeEventCreate encrypts title/comments and leaves schedule plaintext", async () => {
    const key = await testKey();
    const wire = await encodeEventCreate(
      {
        title: "Dentist",
        catId: "appointment",
        date: "2026-07-20",
        allDay: false,
        time: "14:30",
        repeat: "once",
        notify: true,
        lead: "1d",
        email: "you@mail.com",
        comments: [{ id: "c1", text: "Bring card", at: "2026-07-18T10:00:00" }],
      },
      key,
    );
    expect(wire.enc).toBe(1);
    expect(wire.payload).toBeTruthy();
    expect(wire.catId).toBe("appointment");
    expect(wire.date).toBe("2026-07-20");
    expect(wire.email).toBe("you@mail.com");
    expect(wire).not.toHaveProperty("title");
    expect(wire).not.toHaveProperty("comments");

    const decoded = await decodeEvent({ id: "ev1", ...wire }, key);
    expect(decoded.title).toBe("Dentist");
    expect(decoded.comments[0]!.text).toBe("Bring card");
    expect(decoded.email).toBe("you@mail.com");
  });

  test("encodeEventCreate encrypts budget hold fields in the payload", async () => {
    const key = await testKey();
    const wire = await encodeEventCreate(
      {
        title: "Rent",
        catId: "bill",
        date: "2026-07-01",
        allDay: true,
        time: null,
        repeat: "monthly",
        notify: false,
        lead: "1d",
        email: "",
        comments: [],
        budgetHoldEnabled: true,
        budgetHoldAmount: 1200,
        budgetHoldCategoryId: "housing",
      },
      key,
    );

    expect(wire).not.toHaveProperty("budgetHoldAmount");

    const decoded = await decodeEvent({ id: "ev-hold", ...wire }, key);
    expect(decoded.budgetHoldEnabled).toBe(true);
    expect(decoded.budgetHoldAmount).toBe(1200);
    expect(decoded.budgetHoldCategoryId).toBe("housing");
  });

  test("reminder events carry a plaintext copy for the email body", async () => {
    const key = await testKey();
    const wire = await encodeEventCreate(
      {
        title: "Dentist",
        catId: "appointment",
        date: "2026-07-20",
        allDay: false,
        time: "14:30",
        repeat: "once",
        notify: true,
        lead: "1d",
        email: "you@mail.com",
        comments: [{ id: "c1", text: "Bring card", at: "2026-07-18T10:00:00" }],
        budgetHoldEnabled: true,
        budgetHoldAmount: 120,
        budgetHoldCategoryId: "health",
      },
      key,
      { currency: "MYR", holdCategoryName: "Health" },
    );

    expect(wire.notifyDetails).toEqual({
      title: "Dentist",
      hold: { amount: 120, currency: "MYR", categoryName: "Health" },
      comments: ["Bring card"],
    });
    /* Secrets are still encrypted — the copy exists only for delivery. */
    expect(wire).not.toHaveProperty("title");
    expect(wire).not.toHaveProperty("comments");
    expect(createEventSchema.safeParse(wire).success).toBe(true);
  });

  test("events without reminders carry no plaintext copy", async () => {
    const key = await testKey();
    const wire = await encodeEventCreate(
      {
        title: "Dentist",
        catId: "appointment",
        date: "2026-07-20",
        allDay: true,
        time: null,
        repeat: "once",
        notify: false,
        lead: "1d",
        email: "you@mail.com",
        comments: [],
      },
      key,
    );

    expect(wire).not.toHaveProperty("notifyDetails");
  });

  test("reminder events carry a plaintext copy without a per-event email", async () => {
    const key = await testKey();
    const wire = await encodeEventCreate(
      {
        title: "Dentist",
        catId: "appointment",
        date: "2026-07-20",
        allDay: true,
        time: null,
        repeat: "once",
        notify: true,
        lead: "1d",
        email: "",
        comments: [],
      },
      key,
    );

    expect(wire.notifyDetails).toEqual({ title: "Dentist" });
  });

  test("switching reminders off sends null so the server clears the copy", async () => {
    const key = await testKey();
    const patch = await encodeEventUpdate(
      {
        title: "Dentist",
        catId: "appointment",
        date: "2026-07-20",
        allDay: true,
        time: null,
        repeat: "once",
        notify: false,
        lead: "1d",
        email: "you@mail.com",
        comments: [{ id: "c1", text: "Bring card", at: "2026-07-18T10:00:00" }],
      },
      key,
    );

    expect(patch.notifyDetails).toBeNull();
    expect(updateEventSchema.safeParse(patch).success).toBe(true);
  });

  test("the plaintext copy stays inside the schema limits", async () => {
    const key = await testKey();
    const wire = await encodeEventCreate(
      {
        title: "T".repeat(400),
        catId: "personal",
        date: "2026-07-20",
        allDay: true,
        time: null,
        repeat: "once",
        notify: true,
        lead: "1d",
        email: "you@mail.com",
        comments: Array.from({ length: 30 }, (_, i) => ({
          id: `c${i}`,
          text: "x".repeat(900),
          at: "2026-07-18T10:00:00",
        })),
        budgetHoldEnabled: true,
        budgetHoldAmount: 80,
        budgetHoldCategoryId: "misc",
      },
      key,
      { currency: "not-a-code", holdCategoryName: "N".repeat(90) },
    );

    expect(wire.notifyDetails?.title).toHaveLength(200);
    expect(wire.notifyDetails?.comments).toHaveLength(20);
    expect(wire.notifyDetails?.comments?.[0]).toHaveLength(500);
    expect(wire.notifyDetails?.hold?.amount).toBe(80);
    /* Unusable currency codes are dropped rather than rejected server-side. */
    expect(wire.notifyDetails?.hold?.currency).toBeUndefined();
    expect(wire.notifyDetails?.hold?.categoryName).toHaveLength(64);
    expect(createEventSchema.safeParse(wire).success).toBe(true);
  });

  test("decodeEvent supports legacy plaintext events", async () => {
    const key = await testKey();
    const decoded = await decodeEvent(
      {
        id: "legacy",
        title: "Old event",
        catId: "personal",
        date: "2026-01-01",
        allDay: true,
        time: null,
        repeat: "once",
        notify: false,
        lead: "1d",
        email: "",
        comments: [],
      },
      key,
    );
    expect(decoded.title).toBe("Old event");
  });

  test("encodeTodoListCreate / decodeTodoList round-trip", async () => {
    const key = await testKey();
    const wire = await encodeTodoListCreate(
      {
        name: "Groceries",
        icon: "📋",
        tasks: [{ id: "t1", title: "Milk", done: false }],
      },
      key,
    );
    expect(wire.enc).toBe(1);
    expect(wire).not.toHaveProperty("name");
    const decoded = await decodeTodoList({ id: "list1", ...wire }, key);
    expect(decoded.name).toBe("Groceries");
    expect(decoded.tasks[0]!.title).toBe("Milk");
  });

  test("decodeTodoList supports legacy plaintext lists", async () => {
    const key = await testKey();
    const decoded = await decodeTodoList(
      {
        id: "legacy",
        name: "Chores",
        icon: "☑",
        tasks: [{ id: "t1", title: "Sweep", done: true }],
      },
      key,
    );
    expect(decoded.name).toBe("Chores");
    expect(decoded.tasks[0]!.done).toBe(true);
  });
});
