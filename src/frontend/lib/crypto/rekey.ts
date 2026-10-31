/**
 * Re-encrypt all account ciphertext from a legacy ledger key to a Custos key.
 * Fails closed — callers must not mark migration complete if this throws.
 */

import { resetPersonalization } from "@/frontend/lib/personalization-client";
import { identityStorage } from "@/frontend/auth/lib/identity-storage";
import { api } from "@/frontend/lib/api";
import type {
  CapitalPlanSecrets,
  CategorySecrets,
  TodoListSecrets,
  VehicleSecrets,
  WalletSecrets,
} from "./e2ee";
import { decryptJson, encryptJson } from "./e2ee";

/** Re-encrypt one payload string from oldKey to newKey. */
async function rewritePayload(
  oldKey: CryptoKey,
  newKey: CryptoKey,
  payload: string,
): Promise<string> {
  const secrets = await decryptJson<unknown>(oldKey, payload);

  return encryptJson(newKey, secrets);
}

/** Page through every expense and rewrite payloads under `newKey`. */
async function rekeyExpenses(oldKey: CryptoKey, newKey: CryptoKey): Promise<void> {
  let before: string | undefined;
  let beforeId: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const page = await api.expenses.list({
      limit: 100,
      before,
      beforeId,
    });

    for (const wire of page.expenses) {
      if (wire.enc !== 1 || !wire.payload) continue;

      const payload = await rewritePayload(oldKey, newKey, wire.payload);
      await api.expenses.update(wire.id, { enc: 1, payload });
    }

    hasMore = !!page.hasMore;
    before = page.nextBefore ?? undefined;
    beforeId = page.nextBeforeId ?? undefined;
  }
}

/** Page through every event and rewrite payloads under `newKey`. */
async function rekeyEvents(oldKey: CryptoKey, newKey: CryptoKey): Promise<void> {
  let before: string | undefined;
  let beforeId: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const page = await api.events.list({
      limit: 100,
      before,
      beforeId,
    });

    for (const wire of page.events) {
      if (wire.enc !== 1 || !wire.payload) continue;

      const payload = await rewritePayload(oldKey, newKey, wire.payload);
      await api.events.update(wire.id, { enc: 1, payload });
    }

    hasMore = !!page.hasMore;
    before = page.nextBefore ?? undefined;
    beforeId = page.nextBeforeId ?? undefined;
  }
}

/** Page through vehicle fills and rewrite payloads under `newKey`. */
async function rekeyVehicleFills(oldKey: CryptoKey, newKey: CryptoKey): Promise<void> {
  let before: string | undefined;
  let beforeId: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const page = await api.vehicles.fills.list({
      limit: 100,
      before,
      beforeId,
    });

    for (const wire of page.fills) {
      if (wire.enc !== 1 || !wire.payload) continue;

      const payload = await rewritePayload(oldKey, newKey, wire.payload);
      await api.vehicles.fills.update(wire.id, { enc: 1, payload });
    }

    hasMore = page.hasMore;
    before = page.nextBefore ?? undefined;
    beforeId = page.nextBeforeId ?? undefined;
  }
}

/**
 * Decrypt every encrypted entity with `oldKey` and write it back with `newKey`.
 * Throws on the first failure so the session can keep the old key.
 */
export async function rekeyLedgerToCustos(oldKey: CryptoKey, newKey: CryptoKey): Promise<void> {
  const address = identityStorage.session();
  /* Disposable history: a failed reset retries from the stored control key, never blocks rekey. */
  if (address) await resetPersonalization(address).catch(() => {});
  const { wallets } = await api.wallets.list();

  for (const wire of wallets) {
    if (wire.enc !== 1 || !wire.payload) continue;

    const secrets = await decryptJson<WalletSecrets>(oldKey, wire.payload);
    await api.wallets.update(wire.id, {
      enc: 1,
      payload: await encryptJson(newKey, secrets),
    });
  }

  const categoriesWire = await api.categories.list();

  if (categoriesWire.enc === 1 && categoriesWire.payload) {
    const secrets = await decryptJson<CategorySecrets>(oldKey, categoriesWire.payload);
    await api.categories.update({
      enc: 1,
      payload: await encryptJson(newKey, secrets),
    });
  }

  await rekeyExpenses(oldKey, newKey);
  await rekeyEvents(oldKey, newKey);

  const { todoLists } = await api.todoLists.list();

  for (const wire of todoLists) {
    if (wire.enc !== 1 || !wire.payload) continue;

    const secrets = await decryptJson<TodoListSecrets>(oldKey, wire.payload);
    await api.todoLists.update(wire.id, {
      enc: 1,
      payload: await encryptJson(newKey, secrets),
    });
  }

  const { capitalPlans } = await api.capitalPlans.list();

  for (const wire of capitalPlans) {
    if (wire.enc !== 1 || !wire.payload) continue;

    const secrets = await decryptJson<CapitalPlanSecrets>(oldKey, wire.payload);
    await api.capitalPlans.update(wire.id, {
      enc: 1,
      payload: await encryptJson(newKey, secrets),
    });
  }

  const { vehicles } = await api.vehicles.list();

  for (const wire of vehicles) {
    if (wire.enc !== 1 || !wire.payload) continue;

    const secrets = await decryptJson<VehicleSecrets>(oldKey, wire.payload);
    await api.vehicles.update(wire.id, {
      enc: 1,
      payload: await encryptJson(newKey, secrets),
    });
  }

  await rekeyVehicleFills(oldKey, newKey);

  const { routines } = await api.daily.routines.list();

  for (const wire of routines) {
    if (wire.enc !== 1 || !wire.payload) continue;

    const payload = await rewritePayload(oldKey, newKey, wire.payload);
    await api.daily.routines.update(wire.id, { enc: 1, payload });
  }

  /* A nudge's timing and push copy are plaintext columns the PATCH replaces as a whole,
     so they are sent back exactly as stored beside the rewritten ciphertext. */
  const { nudges } = await api.nudges.list();

  for (const wire of nudges) {
    if (wire.enc !== 1 || !wire.payload) continue;

    const payload = await rewritePayload(oldKey, newKey, wire.payload);
    await api.nudges.update(wire.id, {
      enc: 1,
      payload,
      enabled: wire.enabled,
      everyMin: wire.everyMin,
      windowStart: wire.windowStart,
      windowEnd: wire.windowEnd,
      notifyDetails: wire.notifyDetails ?? null,
      metOn: wire.metOn ?? null,
    });
  }

  for (const row of nudges) {
    let cursor: string | undefined;
    do {
      const page = await api.nudges.checkIns(row.id, { cursor }, { fresh: true });
      for (const event of page.events)
        await api.nudges.rekeyCheckIn({
          ...event,
          payload: await rewritePayload(oldKey, newKey, event.payload),
        });
      cursor = page.cursor ?? undefined;
    } while (cursor);
  }

  /* Completions are rewritten through the same idempotent set-state the app uses,
     so each stays on its routine and period. */
  const { completions } = await api.daily.completions.list();

  for (const wire of completions) {
    if (wire.enc !== 1 || !wire.payload) continue;

    const payload = await rewritePayload(oldKey, newKey, wire.payload);
    await api.daily.completions.put({
      routineId: wire.routineId,
      period: wire.period,
      enc: 1,
      payload,
    });
  }
}
