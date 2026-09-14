/**
 * Shared security header values for API middleware and static app delivery.
 * Keep vercel.json in sync — tests/security/headers-parity.test.ts guards drift.
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

/**
 * SHA-256 hash (CSP script-src `'sha256-…'` source) of the exact contents of
 * the inline anti-FOUC theme bootstrap `<script>` in src/index.html. This
 * allow-lists that one specific inline script instead of `'unsafe-inline'`,
 * which would allow any inline script — including one injected by an XSS.
 * `tests/security/inline-script-hash.test.ts` recomputes this from the live
 * file and fails if it no longer matches, so an edited boot script is caught
 * here rather than silently CSP-blocked (and the site losing its pre-paint
 * theme) in production.
 */
export const HTML_BOOT_SCRIPT_HASH = "'sha256-XuORDldw5zHd4yMsD80WDK/IkSe4CanWO13PK1IIuhg='";

/** CSP for the HTML app shell (inline theme bootstrap script). */
export const HTML_CONTENT_SECURITY_POLICY = `default-src 'self'; script-src 'self' ${HTML_BOOT_SCRIPT_HASH}; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`;

export const HSTS_VALUE = "max-age=31536000; includeSubDomains";

/** Static headers applied to every response (HSTS added when HTTPS). */
export const STATIC_SECURITY_HEADERS: Record<string, string> = {
  [SECURITY_HEADER_NAMES.contentTypeOptions]: "nosniff",
  [SECURITY_HEADER_NAMES.frameOptions]: "DENY",
  [SECURITY_HEADER_NAMES.referrerPolicy]: "strict-origin-when-cross-origin",
  [SECURITY_HEADER_NAMES.permissionsPolicy]: "camera=(), microphone=(), geolocation=()",
};

/** Headers block for vercel.json (HTML app document). */
export const VERCEL_HTML_HEADERS: Array<{ key: string; value: string }> = [
  ...Object.entries(STATIC_SECURITY_HEADERS).map(([key, value]) => ({ key, value })),
  { key: SECURITY_HEADER_NAMES.csp, value: HTML_CONTENT_SECURITY_POLICY },
  { key: SECURITY_HEADER_NAMES.hsts, value: HSTS_VALUE },
];

/** Whether HSTS should be set for this request. */
export function shouldSetHsts(proto: string | undefined): boolean {
  return proto === "https" || process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
}
