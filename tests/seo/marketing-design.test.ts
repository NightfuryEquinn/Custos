import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const website = join(import.meta.dir, "..", "..", "website");

describe("promotional redesign assets", () => {
  for (const page of ["index.html", "offers.html", "services.html"]) {
    test(`${page} loads the shared styles and local Phosphor icons`, () => {
      const html = readFileSync(join(website, page), "utf8");
      expect(html).toContain('href="site.css"');

      const icons = [...html.matchAll(/src="(icons\/[^".]+\.svg)"/g)].map((match) => match[1]!);
      expect(icons.length).toBeGreaterThan(0);
      for (const icon of icons) expect(existsSync(join(website, icon))).toBe(true);
    });
  }

  test("the home page no longer loads the decorative Three.js scene", () => {
    const html = readFileSync(join(website, "index.html"), "utf8");
    expect(html).not.toContain("three.min.js");
    expect(html).not.toContain('<canvas id="hero-canvas"');
  });
});
