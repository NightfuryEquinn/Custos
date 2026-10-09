import { describe, expect, test } from "bun:test";
import path from "node:path";

type SiteFixture = {
  name: string;
  sitemapPath: string;
  htmlPath: string;
  robotsPath?: string;
};

const root = path.join(import.meta.dir, "..", "..");

const sites: SiteFixture[] = [
  {
    name: "App (custos.nightfuryequinn.app)",
    sitemapPath: path.join(root, "public/sitemap.xml"),
    htmlPath: path.join(root, "src/index.html"),
    robotsPath: path.join(root, "public/robots.txt"),
  },
  {
    name: "Marketing (intro-custos.nightfuryequinn.app)",
    sitemapPath: path.join(root, "website/sitemap.xml"),
    htmlPath: path.join(root, "website/index.html"),
  },
];

function extractLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!.trim());
}

function extractLastmods(xml: string): string[] {
  return [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]!.trim());
}

function extractCanonical(html: string): string | undefined {
  const match = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/);
  return match?.[1];
}

describe.each(sites)("$name sitemap", ({ sitemapPath, htmlPath, robotsPath }) => {
  test("is a well-formed sitemap:// urlset with absolute https:// locs", async () => {
    const xml = await Bun.file(sitemapPath).text();
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');

    const locs = extractLocs(xml);
    expect(locs.length).toBeGreaterThan(0);
    for (const loc of locs) {
      expect(loc).toMatch(/^https:\/\//);
    }
  });

  test("home loc matches the page's canonical URL exactly", async () => {
    const xml = await Bun.file(sitemapPath).text();
    const html = await Bun.file(htmlPath).text();

    const [homeLoc] = extractLocs(xml);
    const canonical = extractCanonical(html);

    expect(canonical).toBeDefined();
    expect(homeLoc).toBe(canonical);
  });

  test("lastmod entries are YYYY-MM-DD and not in the future", async () => {
    const xml = await Bun.file(sitemapPath).text();
    const lastmods = extractLastmods(xml);
    expect(lastmods.length).toBeGreaterThan(0);

    const now = new Date();
    for (const lastmod of lastmods) {
      expect(lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${lastmod}T00:00:00Z`).getTime()).toBeLessThanOrEqual(now.getTime());
    }
  });

  test("page does not opt out of indexing", async () => {
    const html = await Bun.file(htmlPath).text();
    const robotsMeta = html.match(/<meta\s+name="robots"\s+content="([^"]+)"/);

    expect(robotsMeta).not.toBeNull();
    expect(robotsMeta![1]).not.toContain("noindex");
  });

  test.if(Boolean(robotsPath))(
    "robots.txt Sitemap directive matches the canonical origin",
    async () => {
      const html = await Bun.file(htmlPath).text();
      const robots = await Bun.file(robotsPath!).text();

      const canonical = extractCanonical(html);
      expect(canonical).toBeDefined();
      const origin = new URL(canonical!).origin;

      expect(robots).toContain(`Sitemap: ${origin}/sitemap.xml`);
    },
  );
});
