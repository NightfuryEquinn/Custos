import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HTML_BOOT_SCRIPT_HASH, HTML_CONTENT_SECURITY_POLICY } from "@/lib/security-headers";

/**
 * src/index.html carries one inline `<script>` (the anti-FOUC theme
 * bootstrap) that must run synchronously before first paint. It can't be
 * an external `<script src>` instead: Bun's HTML bundler folds any
 * `<script src>` into the bundled module graph, turning it into a deferred
 * module and bringing back the flash it exists to prevent. The CSP
 * allow-lists this one script by content hash instead
 * of `'unsafe-inline'` — this test recomputes that hash from the live file
 * so an edited script is caught here (loudly, in CI) rather than silently
 * CSP-blocked in production, where the only symptom is a lost pre-paint
 * theme.
 */
describe("inline boot-script CSP hash", () => {
  test("HTML_BOOT_SCRIPT_HASH matches src/index.html's inline script", async () => {
    const htmlPath = join(import.meta.dir, "..", "..", "src", "index.html");
    const html = readFileSync(htmlPath, "utf8");
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];

    expect(scripts).toHaveLength(1);
    const body = scripts[0]![1]!;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
    const computed = `'sha256-${Buffer.from(digest).toString("base64")}'`;

    expect(computed).toBe(HTML_BOOT_SCRIPT_HASH);
    expect(HTML_CONTENT_SECURITY_POLICY).toContain(HTML_BOOT_SCRIPT_HASH);
    expect(HTML_CONTENT_SECURITY_POLICY).not.toContain("'unsafe-inline'; style-src");
    expect(HTML_CONTENT_SECURITY_POLICY.split(";")[1]).not.toContain("unsafe-inline");
  });

  test("vercel.json's static CSP header carries the same hash", () => {
    /* vercel.json's headers apply to routes Vercel serves as static files
       (never touching the Bun server that sets HTML_CONTENT_SECURITY_POLICY
       at runtime), so this hash is necessarily a second, hand-maintained
       copy of the same literal — not derived from security-headers.ts. If
       the boot script ever changes without updating this file, the hash
       here goes stale and the header CSP-blocks the script in production
       with no build-time signal; this test is that signal. */
    const vercelPath = join(import.meta.dir, "..", "..", "vercel.json");
    const vercelConfig = readFileSync(vercelPath, "utf8");

    expect(vercelConfig).toContain(HTML_BOOT_SCRIPT_HASH);
  });
});
