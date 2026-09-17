import { createApiApp } from "@/api/app";
import { describe, expect, test } from "bun:test";
import { signIn } from "../helpers/api-client";
import { useMemoryDb } from "../helpers/memory-db";

const app = createApiApp();

/** Create a vehicle for the given cookie's account and return its id. */
async function createVehicle(cookie: string, type = "car"): Promise<string> {
  const res = await app.request("/api/vehicles", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ type, enc: 1, payload: "ciphertext" }),
  });
  expect(res.status).toBe(201);
  const { vehicle } = (await res.json()) as { vehicle: { id: string } };
  return vehicle.id;
}

describe("vehicles routes", () => {
  useMemoryDb();

  test("create and list a vehicle", async () => {
    const cookie = await signIn(app);
    const id = await createVehicle(cookie, "ev");

    const res = await app.request("/api/vehicles", { headers: { cookie } });
    expect(res.status).toBe(200);
    const { vehicles } = (await res.json()) as { vehicles: Array<{ id: string; type: string }> };
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0]!.id).toBe(id);
    expect(vehicles[0]!.type).toBe("ev");
  });

  test("vehicle response withholds ownership keys", async () => {
    const cookie = await signIn(app);
    await createVehicle(cookie);

    const res = await app.request("/api/vehicles", { headers: { cookie } });
    const { vehicles } = (await res.json()) as { vehicles: Array<Record<string, unknown>> };
    expect(Object.keys(vehicles[0]!)).not.toContain("accountId");
  });

  test("update a vehicle's type and payload", async () => {
    const cookie = await signIn(app);
    const id = await createVehicle(cookie, "car");

    const res = await app.request(`/api/vehicles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ type: "van", enc: 1, payload: "updated" }),
    });
    expect(res.status).toBe(200);
    const { vehicle } = (await res.json()) as { vehicle: { type: string; payload: string } };
    expect(vehicle.type).toBe("van");
    expect(vehicle.payload).toBe("updated");
  });

  test("another account cannot read, update, or delete this vehicle", async () => {
    const ownerCookie = await signIn(app);
    const id = await createVehicle(ownerCookie);
    const otherCookie = await signIn(app);

    const listRes = await app.request("/api/vehicles", { headers: { cookie: otherCookie } });
    const { vehicles } = (await listRes.json()) as { vehicles: unknown[] };
    expect(vehicles).toHaveLength(0);

    const patchRes = await app.request(`/api/vehicles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: otherCookie },
      body: JSON.stringify({ enc: 1, payload: "hijacked" }),
    });
    expect(patchRes.status).toBe(404);

    const deleteRes = await app.request(`/api/vehicles/${id}`, {
      method: "DELETE",
      headers: { cookie: otherCookie },
    });
    expect(deleteRes.status).toBe(404);
  });

  test("create, list, update, and delete a fill", async () => {
    const cookie = await signIn(app);
    const vehicleId = await createVehicle(cookie);

    const createRes = await app.request("/api/vehicles/fills", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        vehicleId,
        date: "2026-08-01",
        partial: false,
        enc: 1,
        payload: "fill-1",
      }),
    });
    expect(createRes.status).toBe(201);
    const { fill } = (await createRes.json()) as { fill: { id: string; vehicleId: string } };
    expect(fill.vehicleId).toBe(vehicleId);

    const listRes = await app.request(`/api/vehicles/fills?vehicleId=${vehicleId}`, {
      headers: { cookie },
    });
    const { fills } = (await listRes.json()) as { fills: Array<{ id: string }> };
    expect(fills).toHaveLength(1);

    const patchRes = await app.request(`/api/vehicles/fills/${fill.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ enc: 1, payload: "fill-1-updated", partial: true }),
    });
    expect(patchRes.status).toBe(200);
    const { fill: updated } = (await patchRes.json()) as {
      fill: { partial: boolean; payload: string };
    };
    expect(updated.partial).toBe(true);
    expect(updated.payload).toBe("fill-1-updated");

    const deleteRes = await app.request(`/api/vehicles/fills/${fill.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(deleteRes.status).toBe(200);

    const afterDelete = await app.request(`/api/vehicles/fills?vehicleId=${vehicleId}`, {
      headers: { cookie },
    });
    const { fills: remaining } = (await afterDelete.json()) as { fills: unknown[] };
    expect(remaining).toHaveLength(0);
  });

  test("deleting a vehicle cascades to its fills", async () => {
    const cookie = await signIn(app);
    const vehicleId = await createVehicle(cookie);

    await app.request("/api/vehicles/fills", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        vehicleId,
        date: "2026-08-01",
        partial: false,
        enc: 1,
        payload: "fill-1",
      }),
    });

    const deleteRes = await app.request(`/api/vehicles/${vehicleId}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(deleteRes.status).toBe(200);

    const fillsRes = await app.request(`/api/vehicles/fills?vehicleId=${vehicleId}`, {
      headers: { cookie },
    });
    const { fills } = (await fillsRes.json()) as { fills: unknown[] };
    expect(fills).toHaveLength(0);
  });

  test("deleting an expense unlinks the fill that logged it", async () => {
    const cookie = await signIn(app);
    const vehicleId = await createVehicle(cookie);

    const walletRes = await app.request("/api/wallets", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ currency: "MYR", enc: 1, payload: "wallet" }),
    });
    const { wallet } = (await walletRes.json()) as { wallet: { id: string } };

    const expenseRes = await app.request("/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        walletId: wallet.id,
        date: "2026-08-01",
        enc: 1,
        payload: "expense",
      }),
    });
    const { expense } = (await expenseRes.json()) as { expense: { id: string } };

    const linkedRes = await app.request("/api/vehicles/fills", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        vehicleId,
        date: "2026-08-01",
        partial: false,
        expenseId: expense.id,
        enc: 1,
        payload: "linked-fill",
      }),
    });
    expect(linkedRes.status).toBe(201);

    const otherRes = await app.request("/api/vehicles/fills", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        vehicleId,
        date: "2026-08-02",
        partial: false,
        enc: 1,
        payload: "other",
      }),
    });
    const { fill: otherFill } = (await otherRes.json()) as { fill: { id: string } };

    const deleteRes = await app.request(`/api/expenses/${expense.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(deleteRes.status).toBe(200);

    /* The dead link is what hides the fill's "Log" button, so leaving it would
       make the payment impossible to record again. */
    const fillsRes = await app.request(`/api/vehicles/fills?vehicleId=${vehicleId}`, {
      headers: { cookie },
    });
    const { fills } = (await fillsRes.json()) as { fills: { id: string; expenseId?: string }[] };
    expect(fills).toHaveLength(2);
    expect(fills.every((f) => f.expenseId === undefined)).toBe(true);
    expect(fills.some((f) => f.id === otherFill.id)).toBe(true);
  });

  test("rejects an unknown vehicle type", async () => {
    const cookie = await signIn(app);
    const res = await app.request("/api/vehicles", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ type: "spaceship", enc: 1, payload: "x" }),
    });
    expect(res.status).toBe(400);
  });
});
