import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const outdir = path.join(root, "dist");
await rm(outdir, { recursive: true, force: true });

const entrypoints = [...new Bun.Glob("src/**/*.html").scanSync()];

const frontend = await Bun.build({
  entrypoints,
  outdir,
  minify: true,
  target: "browser",
  sourcemap: false,
  splitting: true,
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});

if (!frontend.success) {
  console.error(frontend.logs);
  process.exit(1);
}

for (const output of frontend.outputs) {
  console.log(` ${path.relative(root, output.path)}  ${(output.size / 1024).toFixed(1)} KB`);
}

/*
 * Bun's HTML bundler mis-references the entry chunk in the emitted <script src>
 * under splitting:true — it can point at an unrelated chunk instead of the real
 * entry-point, leaving the app unmounted (blank page) in production. Patch the
 * script tag to the actual entry-point chunk after the fact.
 */
const jsEntries = frontend.outputs.filter(
  (o) => o.kind === "entry-point" && o.path.endsWith(".js"),
);
const htmlEntries = frontend.outputs.filter(
  (o) => o.kind === "entry-point" && o.path.endsWith(".html"),
);
if (jsEntries.length !== 1 || htmlEntries.length !== 1) {
  console.error(
    `Expected exactly one JS entry-point and one HTML entry-point, got ${jsEntries.length} JS / ${htmlEntries.length} HTML`,
  );
  process.exit(1);
}
const entryChunkName = path.basename(jsEntries[0]!.path);
const htmlPath = htmlEntries[0]!.path;
const html = await Bun.file(htmlPath).text();
const patched = html.replace(/src="\.\/chunk-[^"]+\.js"/, `src="./${entryChunkName}"`);
if (patched === html && !html.includes(`src="./${entryChunkName}"`)) {
  console.error("Could not locate the entry <script src> to patch in index.html");
  process.exit(1);
}
await Bun.write(htmlPath, patched);

const apiDir = path.join(root, "api");
await mkdir(apiDir, { recursive: true });
await rm(path.join(apiDir, "index.js"), { force: true });
await rm(path.join(apiDir, "handler.js"), { force: true });
await rm(path.join(apiDir, "vercel-api.js"), { force: true });

/* Drop prior hashed email assets from the old type:"file" import approach. */
for await (const entry of new Bun.Glob("logo-*.png").scan({ cwd: apiDir })) {
  await rm(path.join(apiDir, entry), { force: true });
}

/* Embed the logo in the API bundle so Vercel serverless has no sidecar PNG. */
const logoBytes = await Bun.file(path.join(root, "src/frontend/assets/logo.png")).arrayBuffer();
const logoBase64 = Buffer.from(logoBytes).toString("base64");

const api = await Bun.build({
  entrypoints: ["./src/vercel-api.ts"],
  outdir: "./api",
  minify: true,
  target: "bun",
  define: {
    __EMAIL_LOGO_BASE64__: JSON.stringify(logoBase64),
  },
});

if (!api.success) {
  console.error(api.logs);
  process.exit(1);
}

await rename(path.join(apiDir, "vercel-api.js"), path.join(apiDir, "handler.js"));

const apiBundle = path.join(apiDir, "handler.js");
const { size } = await Bun.file(apiBundle).stat();
console.log(` ${path.relative(root, apiBundle)}  ${(size / 1024).toFixed(1)} KB`);
console.log(` embedded email logo  ${(logoBytes.byteLength / 1024).toFixed(1)} KB`);

/* Copy PWA assets (manifest + service worker) into dist. */
const publicDir = path.join(root, "public");
for await (const entry of new Bun.Glob("*").scan({ cwd: publicDir })) {
  const src = path.join(publicDir, entry);
  const dest = path.join(outdir, entry);
  await Bun.write(dest, Bun.file(src));
  const st = await Bun.file(dest).stat();
  console.log(` ${path.relative(root, dest)}  ${(st.size / 1024).toFixed(1)} KB`);
}

/* Copy the SIL OFL license text alongside the extracted font files below
   (matches the convention already used by website/fonts/). */
const fontsSrcDir = path.join(root, "src/frontend/assets/fonts");
const fontsDestDir = path.join(outdir, "fonts");
await mkdir(fontsDestDir, { recursive: true });
for (const name of ["OFL.txt", "NOTICE.txt"]) {
  await Bun.write(path.join(fontsDestDir, name), Bun.file(path.join(fontsSrcDir, name)));
}

/*
 * Un-inline the fonts CSS bundled it as base64.
 *
 * fonts.css references fonts by a *relative* url("../assets/fonts/...") —
 * that's required for `bun run dev` (src/index.ts's Bun.serve HTML import
 * has no equivalent to Bun.build's `external` option; a root-relative
 * `url("/fonts/...")` there fails outright — Bun resolves it against the
 * OS filesystem root, not the project, so it 404s trying to resolve
 * "C:\fonts\..." or "/fonts/..." at the filesystem level: "Could not
 * resolve"). But `Bun.build` (this file) has no `loader` override for CSS
 * url() either way — a relative path always gets base64-inlined, real file
 * or not. Rather than fight the bundler with a source-level workaround,
 * decode what it already inlined back into real files post-build: same
 * `fonts.css` works unmodified in both dev and prod, and this is the one
 * place a build-time-only rewrite is safe.
 */
const cssOutputs = frontend.outputs.filter((o) => o.path.endsWith(".css"));
let fontBytes = 0;
let fontCount = 0;
for (const cssOutput of cssOutputs) {
  const css = await Bun.file(cssOutput.path).text();
  const writes: Promise<unknown>[] = [];
  const rewritten = css.replace(
    /url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\)/g,
    (_match, base64: string) => {
      const bytes = Buffer.from(base64, "base64");
      const hash = Bun.hash(bytes).toString(16);
      const filename = `font-${hash}.woff2`;
      writes.push(Bun.write(path.join(fontsDestDir, filename), bytes));
      fontBytes += bytes.byteLength;
      fontCount++;
      return `url(/fonts/${filename})`;
    },
  );
  await Promise.all(writes);
  if (rewritten !== css) await Bun.write(cssOutput.path, rewritten);
}
console.log(
  ` ${path.relative(root, fontsDestDir)}/*  ${fontCount} font file(s), ${(fontBytes / 1024).toFixed(1)} KB extracted from CSS`,
);
