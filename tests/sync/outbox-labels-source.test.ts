import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * Outbox labels sit in IndexedDB as plain text. They must be fixed words, never
 * something the user typed (a note, a title, a name). This fails the build if a
 * hook starts passing a variable as a label again.
 */
test("every outbox label in the data hooks is a fixed string", () => {
  const root = join(import.meta.dir, "..", "..", "src", "frontend", "lib", "hooks");
  for (const file of ["useLedger.ts", "useDaily.ts"]) {
    const source = readFileSync(join(root, file), "utf8");
    const dynamic = [...source.matchAll(/\blabel:[ \t]*(?![ \t"'`])[^,\n]+/g)].map((m) => m[0]);

    expect({ file, dynamic }).toEqual({ file, dynamic: [] });
  }
});
