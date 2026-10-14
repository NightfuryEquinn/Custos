/**
 * Shared security header values for API middleware and static app delivery.
 * Keep vercel.json in sync (a mismatch means the two deliver different headers).
 * Its CSP allow-lists the inline theme script in src/index.html by SHA-256, so recompute
 * that hash there whenever the script is edited, or the browser silently blocks it.
 */

export const SECURITY_HEADER_NAMES = {
  contentTypeOptions: "X-Content-Type-Options",
  frameOptions: "X-Frame-Options",
  referrerPolicy: "Referrer-Policy",
  permissionsPolicy: "Permissions-Policy",
  csp: "Content-Security-Policy",
  hsts: "Strict-Transport-Security",
} as const;

/** CSP for JSON API responses (no inline scripts). */
export const API_CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'";

export const HSTS_VALUE = "max-age=31536000; includeSubDomains";

/** Static headers applied to every response (HSTS added when HTTPS). */
export const STATIC_SECURITY_HEADERS: Record<string, string> = {
  [SECURITY_HEADER_NAMES.contentTypeOptions]: "nosniff",
  [SECURITY_HEADER_NAMES.frameOptions]: "DENY",
  [SECURITY_HEADER_NAMES.referrerPolicy]: "strict-origin-when-cross-origin",
  [SECURITY_HEADER_NAMES.permissionsPolicy]: "camera=(), microphone=(), geolocation=()",
};

/** Whether HSTS should be set for this request. */
export function shouldSetHsts(proto: string | undefined): boolean {
  return proto === "https" || process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
}
