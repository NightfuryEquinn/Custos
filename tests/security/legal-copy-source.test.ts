import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");

const CALL_SITES = [
  "src/frontend/auth/components/LegalModals.tsx",
  "src/frontend/auth/components/DataPrivacyModal.tsx",
  "src/frontend/auth/AuthScreen.tsx",
];

/*
 * The old "de-identified category totals with vetted research and
 * advertising partners" claim was unimplementable (server stores ciphertext;
 * category totals are computed client-side) and had already drifted into
 * three slightly different copies. This test is what stops it recurring:
 * the retired phrase must never reappear, and the copy must come from one
 * shared module rather than being retyped at each call site.
 */
describe("legal copy has one source", () => {
  test("the retired sharing claim does not reappear anywhere in src/", () => {
    for (const path of ["src/frontend", "src/lib", "src/api", "src/schemas"]) {
      const dir = join(root, path);
      const files = readdirRecursive(dir).filter((f) => /\.(ts|tsx)$/.test(f));
      for (const file of files) {
        const content = readFileSync(file, "utf8");
        expect(content.toLowerCase()).not.toContain("advertising partners");
        expect(content.toLowerCase()).not.toContain("research partners");
      }
    }
  });

  test("each sharing-copy call site imports from src/lib/legal", () => {
    for (const path of CALL_SITES) {
      const content = readFileSync(join(root, path), "utf8");
      expect(content).toMatch(/from ["']@\/lib\/legal["']/);
    }
  });

  test("the stale product name is gone from user-visible legal text", () => {
    const content = readFileSync(
      join(root, "src/frontend/auth/components/LegalModals.tsx"),
      "utf8",
    );
    expect(content).not.toContain("Sched Ledger");
    expect(content).not.toContain("Sched-Ledger");
  });
});

/** List every file under `dir`, recursing into subdirectories. */
function readdirRecursive(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) files.push(...readdirRecursive(full));
    else files.push(full);
  }
  return files;
}
