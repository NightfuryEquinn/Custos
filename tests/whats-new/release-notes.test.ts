import { RELEASE_NOTES } from "@/frontend/lib/whats-new/release-notes";
import { APP_VERSION } from "@/lib/version";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("RELEASE_NOTES", () => {
  test("newest entry matches APP_VERSION", () => {
    expect(RELEASE_NOTES[0]?.version).toBe(APP_VERSION);
  });

  test("versions are unique", () => {
    const versions = RELEASE_NOTES.map((notes) => notes.version);

    expect(new Set(versions).size).toBe(versions.length);
  });
});

/*
 * The version bump ritual touches package.json and three spots in
 * website/index.html separately from APP_VERSION — a partial bump (only
 * version.ts moved) used to pass `bun test` green because nothing checked
 * the other four. This is what closes that gap.
 */
describe("version bump is complete", () => {
  const root = join(import.meta.dir, "..", "..");

  test("package.json version matches APP_VERSION", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      version: string;
    };
    expect(pkg.version).toBe(APP_VERSION);
  });

  test("all three website/index.html version strings match APP_VERSION", () => {
    const html = readFileSync(join(root, "website/index.html"), "utf8");

    const jsonLd = html.match(/"softwareVersion":\s*"([^"]+)"/)?.[1];
    const badge = html.match(/<span class="ver">v([^<]+)<\/span>/)?.[1];
    const footer = html.match(/Custos v([\d.]+)\s*—/)?.[1];

    expect(jsonLd).toBe(APP_VERSION);
    expect(badge).toBe(APP_VERSION);
    expect(footer).toBe(APP_VERSION);
  });
});
