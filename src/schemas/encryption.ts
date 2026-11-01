import { E2EE_VERSION } from "@/lib/e2ee-version";
import { z } from "zod";

export const e2eeVersionSchema = z.literal(E2EE_VERSION);

/** Base64-encoded AES-GCM blob (IV + ciphertext + tag). */
export const encryptedPayloadSchema = z.string().min(1).max(65_536);

/** SHA-256 hex digest identifying a recurring expense series. */
export const seriesKeySchema = z.string().regex(/^[a-f0-9]{64}$/i, "Invalid series key");
