import { createApiApp } from "@/api/app";
import { COLLECTIONS } from "@/db/collections";
import { beforeEach, describe, expect, test } from "bun:test";
import { signIn } from "../helpers/api-client";
import { useMemoryDb } from "../helpers/memory-db";

const app = createApiApp();

describe("GET /wallets read-only refresh", () => {
  const memory = useMemoryDb();
  let cookie = "";
  beforeEach(async () => {
    cookie = await signIn(app);
  });

  test("reads without creating a default wallet or updating old rows", async () => {
    const col = memory().collection(COLLECTIONS.financialWallets);
    const count = await col.countDocuments({});
    const first = await app.request("/api/wallets?readOnly=true", { headers: { cookie } });
    expect(first.status).toBe(200);
    expect((await first.json()).wallets).toEqual([]);
    expect(await col.countDocuments({})).toBe(count);

    const normal = await app.request("/api/wallets", { headers: { cookie } });
    expect(normal.status).toBe(200);
    expect((await normal.json()).wallets).toHaveLength(1);
    const afterNormal = await col.countDocuments({});
    const refreshed = await app.request("/api/wallets?readOnly=true", { headers: { cookie } });
    expect((await refreshed.json()).wallets).toHaveLength(1);
    expect(await col.countDocuments({})).toBe(afterNormal);
  });
});
