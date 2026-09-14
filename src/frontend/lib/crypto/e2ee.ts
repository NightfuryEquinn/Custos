import { E2EE_VERSION } from "@/schemas/encryption";
import { getAddress } from "ethers";
import { normalizeRecurring, type RecurringField } from "@/lib/recurring";
import { AUTH_MESSAGE_PREAMBLE, AUTH_MESSAGE_VERIFY_LINE } from "@/lib/auth-message";

/** Current ledger-key derivation message prefix (Custos). */
export const DERIVATION_MESSAGE_PREFIX = "Custos data encryption key v1";

/**
 * Pre-rename prefix — unlock falls back here, then rekeyLedgerToCustos migrates.
 * Remove after every account has unlocked once on a build that runs rekey
 * (local keyGeneration === "custos").
 */
export const LEGACY_DERIVATION_MESSAGE_PREFIX = "Sched Ledger data encryption key v1";

export type ExpenseSecrets = {
  sub: string;
  amount: number;
  note: string;
};

export type WalletSecrets = {
  name: string;
  income: number;
  startingBalance: number;
  budgets: Record<string, number>;
};

export type CategorySecrets = {
  categories: Array<{
    id: string;
    name: string;
    color: string;
    glyph: string;
    type?: "expense" | "income" | "savings";
    builtin?: boolean;
    archived?: boolean;
    /** Piggy goal. Meaningful only when type is "savings". */
    target?: number;
    deadline?: string;
    subs: Array<{ id: string; name: string; target?: number; deadline?: string }>;
  }>;
};

export type EventSecrets = {
  title: string;
  comments: Array<{ id: string; text: string; at: string }>;
  customLabel?: string;
  customGlyph?: string;
  budgetHoldEnabled?: boolean;
  budgetHoldAmount?: number;
  budgetHoldCategoryId?: string;
  budgetHoldReleasedDates?: string[];
};

export type TodoListSecrets = {
  name: string;
  icon: string;
  tasks: Array<{ id: string; title: string; done: boolean }>;
};

export type CapitalPlanSecrets = {
  name: string;
  templateId?: string;
  glyph: string;
  targetDate?: string;
  initialBudget?: number;
  createdAt: string;
  items: Array<{
    id: string;
    name: string;
    estimatedCost: number;
    actualCost?: number;
    paid: boolean;
    loggedExpenseId?: string;
    notes?: string;
    dueDate?: string;
  }>;
};

export type VehicleSecrets = {
  name: string;
  model: string;
  plate?: string;
  glyph: string;
  odometerStart?: number;
  tankCapacity?: number;
  notes?: string;
};

export type VehicleFillSecrets = {
  price: number;
  quantity: number;
  odometer?: number;
  station: string;
};

/** Build the SIWE-style message whose signature derives the ledger AES key. */
export function buildDerivationMessage(
  address: string,
  prefix: string = DERIVATION_MESSAGE_PREFIX,
): string {
  return `${prefix}\n\nAddress: ${getAddress(address)}`;
}

/**
 * Validate that a server-issued sign-in challenge has the exact SIWE-style
 * shape `buildAuthMessage` (server-side) produces for this address, and does
 * not carry either ledger-key derivation message.
 *
 * The wallet signs a sign-in challenge with ordinary, deterministic ECDSA
 * (personal_sign) and that signature is POSTed straight back to the server
 * for verification. The ledger key is HKDF-derived from the signature over a
 * *different*, purely client-built message (`buildDerivationMessage`). If a
 * malicious or compromised server (or a MITM, or stored XSS) could get the
 * client to sign the derivation message under the guise of a login
 * challenge, the identical signature it returns would double as the ledger
 * key handed straight to that server — a full E2EE bypass with no need to
 * ever touch the key store. Never sign a challenge that fails this check.
 */
export function isValidAuthChallenge(message: string, address: string): boolean {
  if (
    message.includes(DERIVATION_MESSAGE_PREFIX) ||
    message.includes(LEGACY_DERIVATION_MESSAGE_PREFIX)
  ) {
    return false;
  }

  let normalized: string;
  try {
    normalized = getAddress(address);
  } catch {
    return false;
  }

  const lines = message.split("\n");
  if (lines.length !== 8) return false;
  if (lines[0] !== AUTH_MESSAGE_PREAMBLE) return false;
  if (lines[1] !== "") return false;
  if (lines[2] !== `Address: ${normalized}`) return false;
  if (lines[3] !== AUTH_MESSAGE_VERIFY_LINE) return false;
  if (lines[4] !== "") return false;
  if (!lines[5] || lines[5] === "URI: " || !lines[5].startsWith("URI: ")) return false;
  if (!lines[6] || lines[6] === "Nonce: " || !lines[6].startsWith("Nonce: ")) return false;
  if (!lines[7]?.startsWith("Issued At: ")) return false;

  const issuedAt = Date.parse(lines[7].slice("Issued At: ".length));
  return !Number.isNaN(issuedAt);
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return [...view].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const HKDF_INFO = new TextEncoder().encode("ledger-e2ee-aes-gcm-v1");
const SERIES_HMAC_INFO = new TextEncoder().encode("ledger-e2ee-series-hmac-v1");

export async function deriveKeyFromSignature(signature: string): Promise<CryptoKey> {
  const sigBytes = hexToBytes(signature);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    sigBytes as BufferSource,
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: HKDF_INFO },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Derive the non-extractable HMAC key used to build recurring-expense series
 * keys (see `expenseSeriesKey`). Same signature, same HKDF construction as
 * `deriveKeyFromSignature`, but a distinct `info` label so this key is
 * independent of — and cannot be recovered from — the ledger encryption key.
 */
export async function deriveSeriesHmacKeyFromSignature(signature: string): Promise<CryptoKey> {
  const sigBytes = hexToBytes(signature);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    sigBytes as BufferSource,
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: SERIES_HMAC_INFO },
    keyMaterial,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export async function encryptJson(key: CryptoKey, data: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  const packed = new Uint8Array(1 + iv.length + ciphertext.byteLength);
  packed[0] = E2EE_VERSION;
  packed.set(iv, 1);
  packed.set(new Uint8Array(ciphertext), 1 + iv.length);
  return bytesToBase64(packed);
}

export async function decryptJson<T>(key: CryptoKey, payload: string): Promise<T> {
  const packed = base64ToBytes(payload);
  if (packed.length < 14 || packed[0] !== E2EE_VERSION) {
    throw new Error("Unsupported encryption format");
  }
  const iv = packed.slice(1, 13);
  const ciphertext = packed.slice(13);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

/**
 * Group a recurring expense's occurrences under one opaque, server-matchable
 * key without exposing its note or subcategory. HMAC-SHA256 under a
 * per-account key derived from the wallet signature (never sent to, or
 * knowable by, the server) — previously an unsalted SHA-256 digest of the
 * same fields, which let a server that already knows `walletId` (its own
 * data) and the small enumerable space of `sub`/`recurring` values run an
 * offline dictionary attack recovering the plaintext note.
 */
export async function expenseSeriesKey(
  seriesHmacKey: CryptoKey,
  fields: {
    walletId: string;
    sub: string;
    note: string;
    recurring: RecurringField | unknown;
  },
): Promise<string> {
  const raw = `${fields.walletId}|${fields.sub}|${fields.note}|${normalizeRecurring(fields.recurring)}`;
  const mac = await crypto.subtle.sign("HMAC", seriesHmacKey, new TextEncoder().encode(raw));
  return bytesToHex(mac);
}
