import type { IdentityRecord } from "@/frontend/lib/types";
import { walletClient } from "@/frontend/auth/lib/wallet";
import { api } from "@/frontend/lib/api";
import { clearCipherCacheForAddress } from "@/frontend/lib/pwa/cipher-cache";
import {
  buildDerivationMessage,
  decryptJson,
  DERIVATION_MESSAGE_PREFIX,
  deriveKeyFromSignature,
  deriveSeriesHmacKeyFromSignature,
  LEGACY_DERIVATION_MESSAGE_PREFIX,
} from "./e2ee";
import { getKeyGeneration, setKeyGeneration, type KeyGeneration } from "./key-generation";
import { ledgerKeyStore, seriesKeyStore } from "./key-store";
import { rekeyLedgerToCustos } from "./rekey";

export type UnlockResult = {
  generation: KeyGeneration;
  /** True when ciphertext was rewritten from the legacy key to Custos. */
  rekeyed: boolean;
};

/**
 * Sign a derivation message and HKDF-derive the ledger AES key, storing its
 * sibling series-HMAC key (see `expenseSeriesKey`) under the same address as
 * a side effect. Every call site below immediately stores the returned key
 * into `ledgerKeyStore` for the same address, so the two stores stay in
 * sync with whichever key generation ends up adopted.
 */
async function deriveFromPrefix(idn: IdentityRecord, prefix: string): Promise<CryptoKey> {
  const message = buildDerivationMessage(idn.address, prefix);
  let signature = await walletClient.sign(idn, message);

  if (Array.isArray(signature)) signature = signature[0]!;

  const [key, seriesKey] = await Promise.all([
    deriveKeyFromSignature(signature),
    deriveSeriesHmacKeyFromSignature(signature),
  ]);
  seriesKeyStore.set(idn.address, seriesKey);

  return key;
}

/**
 * Probe whether `key` can decrypt any encrypted ledger payload for this account.
 * Empty ledgers (no ciphertext yet) are treated as a successful probe.
 */
async function keyDecryptsLedger(key: CryptoKey): Promise<boolean> {
  const [{ wallets }, categories] = await Promise.all([api.wallets.list(), api.categories.list()]);

  const payloads: string[] = [];

  for (const w of wallets) {
    if (w.enc === 1 && w.payload) payloads.push(w.payload);
  }

  if (categories.enc === 1 && categories.payload) {
    payloads.push(categories.payload);
  }

  if (!payloads.length) {
    const { expenses } = await api.expenses.list({ limit: 1 });
    for (const e of expenses) {
      if (e.enc === 1 && e.payload) payloads.push(e.payload);
    }
  }

  if (!payloads.length) return true;

  try {
    await decryptJson(key, payloads[0]!);

    return true;
  } catch {
    return false;
  }
}

/**
 * Unlock the ledger AES key for an identity.
 * Tries Custos first (or exclusively when already migrated), falls back to legacy,
 * and re-encrypts all server ciphertext when legacy unlock succeeds.
 */
export async function unlockLedgerKey(idn: IdentityRecord): Promise<UnlockResult> {
  const remembered = getKeyGeneration(idn.address);

  if (remembered === "custos") {
    const key = await deriveFromPrefix(idn, DERIVATION_MESSAGE_PREFIX);
    ledgerKeyStore.set(idn.address, key);
    setKeyGeneration(idn.address, "custos");

    return { generation: "custos", rekeyed: false };
  }

  const custosKey = await deriveFromPrefix(idn, DERIVATION_MESSAGE_PREFIX);
  const custosOk = await keyDecryptsLedger(custosKey);

  if (custosOk) {
    ledgerKeyStore.set(idn.address, custosKey);
    setKeyGeneration(idn.address, "custos");

    return { generation: "custos", rekeyed: false };
  }

  const legacyKey = await deriveFromPrefix(idn, LEGACY_DERIVATION_MESSAGE_PREFIX);
  const legacyOk = await keyDecryptsLedger(legacyKey);

  if (!legacyOk) {
    throw new Error("Could not unlock ledger encryption key.");
  }

  ledgerKeyStore.set(idn.address, legacyKey);

  const newKey = await deriveFromPrefix(idn, DERIVATION_MESSAGE_PREFIX);
  await rekeyLedgerToCustos(legacyKey, newKey);
  ledgerKeyStore.set(idn.address, newKey);
  setKeyGeneration(idn.address, "custos");
  await clearCipherCacheForAddress(idn.address);

  return { generation: "custos", rekeyed: true };
}
