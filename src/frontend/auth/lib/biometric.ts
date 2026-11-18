/**
 * Face ID / Touch ID unlock — wraps the device passphrase with a key
 * derived from the WebAuthn PRF extension. PRF only: if the authenticator
 * doesn't return a PRF output, nothing is stored and the feature stays off.
 * The passphrase never touches disk unencrypted, and the wrapping key never
 * touches disk at all — it exists only for the duration of a biometric
 * assertion.
 */

import type { IdentityRecord } from "@/frontend/lib/types";
import { base64ToBytes, bytesToBase64 } from "./device-vault";
import { identityStorage } from "./identity-storage";

const RECORDS_KEY = "ledger:biometric:v1";
const ASKED_KEY = "ledger:biometric:asked:v1";
const PRF_INFO: Uint8Array<ArrayBuffer> = new TextEncoder().encode("custos-biometric-v1");
const LEGACY_PRF_INFO: Uint8Array<ArrayBuffer> = new TextEncoder().encode(
  "sched-ledger-biometric-v1",
);

type BiometricRecord = {
  credentialId: string; // base64
  prfSalt: string; // base64, fixed per-credential eval input
  iv: string; // base64
  ciphertext: string; // base64
};

function readRecords(): Record<string, BiometricRecord> {
  try {
    const raw = localStorage.getItem(RECORDS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Persist biometric records. False when storage rejects the write. */
function writeRecords(records: Record<string, BiometricRecord>): boolean {
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(records));

    return true;
  } catch {
    return false;
  }
}

/** Copy a salt into its own ArrayBuffer so WebAuthn cannot detach the original. */
function saltBuffer(bytes: Uint8Array<ArrayBuffer>): ArrayBuffer {
  return bytes.slice().buffer;
}

/** Read the first PRF output from a credential, when the authenticator returned one. */
function readPrfFirst(credential: PublicKeyCredential | null): ArrayBuffer | undefined {
  const prfResults = credential?.getClientExtensionResults().prf?.results as
    { first?: ArrayBuffer } | undefined;

  return prfResults?.first;
}

function readAsked(): Record<string, true> {
  try {
    const raw = localStorage.getItem(ASKED_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Whether this browser/device can do a platform biometric check at all. */
export async function biometricSupported(): Promise<boolean> {
  try {
    if (!window.PublicKeyCredential) return false;

    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function biometricEnrolled(address: string): boolean {
  return !!readRecords()[address.toLowerCase()];
}

export function wasAskedToEnrollBiometric(address: string): boolean {
  return !!readAsked()[address.toLowerCase()];
}

export function markAskedToEnrollBiometric(address: string) {
  const asked = readAsked();
  asked[address.toLowerCase()] = true;
  try {
    localStorage.setItem(ASKED_KEY, JSON.stringify(asked));
  } catch {
    /* ignore */
  }
}

/** HKDF-derive an AES-GCM wrapping key from a WebAuthn PRF output. */
async function deriveWrapKey(
  prfOutput: ArrayBuffer,
  info: Uint8Array<ArrayBuffer> = PRF_INFO,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", prfOutput, "HKDF", false, ["deriveKey"]);

  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Register a platform credential for `address` and use its PRF output to
 * encrypt `passphrase`. Returns false (storing nothing) when the authenticator
 * doesn't support PRF or the wrapped passphrase could not be saved.
 */
export async function enrollBiometric(
  address: string,
  codename: string,
  passphrase: string,
): Promise<boolean> {
  const prfSalt = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));

  /* Explicit rather than left to the WebAuthn default (which resolves to the
     same value here — the calling origin's effective domain) so a
     credential scope this narrow is a documented decision, not an accident:
     preview/branch deploys on a different hostname correctly get their own,
     non-portable credential. `location` is absent under `bun test`'s
     browser-less runtime — the default (undefined `id`) is fine there since
     navigator.credentials is stubbed in that environment anyway. */
  const rp =
    typeof location !== "undefined"
      ? { id: location.hostname, name: "Custos" }
      : { name: "Custos" };

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp,
      user: { id: userId, name: address, displayName: codename },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "required",
      },
      /* Ask for the PRF secret on create(), while the click's user gesture
         is still active. A follow-up get() often has no gesture on iOS, so
         it is only the fallback when create() returns no output. */
      extensions: { prf: { eval: { first: saltBuffer(prfSalt) } } },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!credential) return false;

  let prfOutput = readPrfFirst(credential);
  if (!prfOutput) {
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ id: credential.rawId, type: "public-key" }],
        userVerification: "required",
        extensions: { prf: { eval: { first: saltBuffer(prfSalt) } } },
      },
    })) as PublicKeyCredential | null;
    prfOutput = readPrfFirst(assertion);
  }
  if (!prfOutput) return false;

  const key = await deriveWrapKey(prfOutput);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(passphrase),
  );

  const records = readRecords();
  records[address.toLowerCase()] = {
    credentialId: bytesToBase64(new Uint8Array(credential.rawId)),
    prfSalt: bytesToBase64(new Uint8Array(prfSalt)),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };

  return writeRecords(records);
}

/** Prompt Face ID / Touch ID and return the decrypted device passphrase. */
export async function unlockWithBiometric(address: string, signal?: AbortSignal): Promise<string> {
  const record = readRecords()[address.toLowerCase()];
  if (!record) throw new Error("Face ID is not set up on this device.");

  const prfSalt = base64ToBytes(record.prfSalt);
  const assertion = (await navigator.credentials.get({
    signal,
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [
        { id: base64ToBytes(record.credentialId).buffer as ArrayBuffer, type: "public-key" },
      ],
      userVerification: "required",
      extensions: { prf: { eval: { first: saltBuffer(prfSalt) } } },
    },
  })) as PublicKeyCredential | null;

  const prfOutput = readPrfFirst(assertion);
  if (!prfOutput) throw new Error("Face ID could not unlock this device.");

  const key = await deriveWrapKey(prfOutput);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(record.iv) },
      key,
      base64ToBytes(record.ciphertext),
    );

    return new TextDecoder().decode(plaintext);
  } catch {
    /* Pre-rename enrollments used a different HKDF info string. */
    try {
      const legacyKey = await deriveWrapKey(prfOutput, LEGACY_PRF_INFO);
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64ToBytes(record.iv) },
        legacyKey,
        base64ToBytes(record.ciphertext),
      );

      return new TextDecoder().decode(plaintext);
    } catch {
      throw new Error("Face ID could not unlock this device.");
    }
  }
}

/** The identity this device should auto-prompt Face ID for, if any. */
export function biometricAutoUnlockIdentity(): IdentityRecord | undefined {
  const addr = identityStorage.session();
  const idn = addr ? identityStorage.find(addr) : undefined;

  return idn?.vault && !idn.injected && biometricEnrolled(idn.address) ? idn : undefined;
}

export function disableBiometric(address: string) {
  const records = readRecords();
  delete records[address.toLowerCase()];
  writeRecords(records);
}
