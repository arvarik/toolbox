/**
 * Frontend performance budget: `npm run build && npm run check:bundle`.
 *
 * Gzips what `dist/index.html` loads on first paint (entry script, module
 * preloads, stylesheets) and every lazy JS chunk, prints the sizes, and exits
 * 1 when the initial JS, the initial CSS, or the largest lazy chunk is over
 * its budget. Raise a budget only on purpose, in the same PR as the growth.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

// About 10% above the 2026-11-09 build: 153.5, 23.6, and 449.8 KiB gzip.
const BUDGET_KIB = {
  "Initial JS": 170,
  "Initial CSS": 26,
  "Largest lazy JS chunk": 495,
};

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const indexHtml = path.join(dist, "index.html");
if (!fs.existsSync(indexHtml)) {
  console.error(`${indexHtml} is missing. Run \`npm run build\` before \`npm run check:bundle\`.`);
  process.exit(1);
}

const gzipKib = (rel: string) => zlib.gzipSync(fs.readFileSync(path.join(dist, rel))).byteLength / 1024;
const initial = [
  ...fs.readFileSync(indexHtml, "utf8").matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="\/(assets\/[^"?#]+\.(?:js|css))"/g),
].map((m) => m[1]);
const js = initial.filter((f) => f.endsWith(".js"));
const css = initial.filter((f) => f.endsWith(".css"));
if (js.length === 0) {
  console.error(`No /assets/*.js entry script found in ${indexHtml}.`);
  process.exit(1);
}
const sum = (files: string[]) => files.reduce((kib, f) => kib + gzipKib(f), 0);
const largestLazy = fs
  .readdirSync(path.join(dist, "assets"))
  .map((f) => `assets/${f}`)
  .filter((f) => f.endsWith(".js") && !initial.includes(f))
  .map((f) => ({ f, kib: gzipKib(f) }))
  .reduce((max, chunk) => (chunk.kib > max.kib ? chunk : max), { f: "-", kib: 0 });

const rows: Array<[keyof typeof BUDGET_KIB, number, string]> = [
  ["Initial JS", sum(js), js.join(", ")],
  ["Initial CSS", sum(css), css.join(", ")],
  ["Largest lazy JS chunk", largestLazy.kib, largestLazy.f],
];

let over = 0;
for (const [label, kib, files] of rows) {
  const budget = BUDGET_KIB[label];
  if (kib > budget) over++;
  console.log(`${kib > budget ? "OVER" : "ok  "} ${label}: ${kib.toFixed(1)} KiB gzip (budget ${budget} KiB) ${files}`);
}
if (over) {
  console.error(`\n${over} bundle budget(s) exceeded. Split or trim the growth, or raise the budget on purpose.`);
  process.exit(1);
}
