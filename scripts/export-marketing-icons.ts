import { mkdir } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as icons from "@phosphor-icons/react/dist/ssr";

const names = [
  "ArrowRight",
  "Coffee",
  "Database",
  "GithubLogo",
  "LockKey",
  "ShieldCheck",
  "Target",
] as const;

await mkdir("website/icons", { recursive: true });
for (const name of names) {
  const Icon = icons[name];
  const svg = renderToStaticMarkup(createElement(Icon, { size: 28, color: "#8f6140" }));
  await Bun.write(`website/icons/${name}.svg`, svg);
}
