import { cp } from "node:fs/promises";

const bundles = [
  { entry: "website/motion.ts", name: "journal-motion.js", format: "esm" },
  /* Classic blocking <head> script, so it must not be an ES module. */
  { entry: "website/theme.ts", name: "theme.js", format: "iife" },
] as const;

for (const { entry, name, format } of bundles) {
  const result = await Bun.build({
    entrypoints: [entry],
    outdir: "website/generated",
    target: "browser",
    format,
    minify: true,
    naming: name,
  });

  if (!result.success) {
    console.error(result.logs);
    process.exit(1);
  }

  console.log(`${name}: ${(result.outputs[0]!.size / 1024).toFixed(1)} KB`);
}
await cp("src/frontend/assets/fonts", "website/generated/fonts", { recursive: true });
const fontStylesheet = await Bun.file("src/frontend/styles/fonts.css").text();
await Bun.write(
  "website/generated/fonts.css",
  fontStylesheet.replaceAll("../assets/fonts/", "./fonts/"),
);
