// Writes every file in docs/brand from the one drawing in kit.ts. Playwright's
// Chromium renders the PNGs. Run `npm run brand`, then commit what it writes.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";
import { COLORS, GROUND, TILE, markSvg, tileSvg, type Master } from "./kit.ts";

const OUT = path.join(import.meta.dirname, "../../docs/brand");

const SVG = {
  "kit-mark.svg": markSvg(COLORS.light, "On a light ground: the primary ink with the amber eye."),
  "kit-mark-dark.svg": markSvg(COLORS.dark, "On a dark ground."),
  "kit-mark-black.svg": markSvg(COLORS.black, "One color, for print or a single ink."),
  "kit-mark-white.svg": markSvg(COLORS.white, "One color, reversed out of a color or a photograph."),
  "kit-app-icon.svg": tileSvg("medium"),
};

await mkdir(OUT, { recursive: true });
for (const [name, svg] of Object.entries(SVG)) await writeFile(path.join(OUT, name), svg);

const browser = await chromium.launch();
// Icons render at their true pixels. Sheets render at 2x so their text stays sharp.
const icons = await browser.newPage({ deviceScaleFactor: 1 });
const sheets = await browser.newPage({ deviceScaleFactor: 2 });

async function shoot(page: Page, html: string, width: number, height: number, file?: string): Promise<Buffer> {
  await page.setViewportSize({ width, height });
  await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0">${html}</body>`);
  const png = await page.screenshot({ omitBackground: true });
  if (file) await writeFile(path.join(OUT, file), png);
  return png;
}

const sized = (svg: string, px: number) =>
  svg.replace("<svg ", `<svg width="${px}" height="${px}" style="display:block" `);

await shoot(icons, sized(SVG["kit-mark.svg"], 512), 512, 512, "kit-mark.png");
await shoot(icons, sized(SVG["kit-mark-dark.svg"], 512), 512, 512, "kit-mark-dark.png");
await shoot(icons, sized(SVG["kit-app-icon.svg"], 1024), 1024, 1024, "kit-app-icon-1024.png");

const TEXT = "font: 15px/1.4 system-ui, sans-serif; color: #4f5259";
const sheet = (gap: number, items: string[]) =>
  `<div style="display:flex;gap:${gap}px;padding:${gap}px;background:${GROUND.light};${TEXT}">${items.join("")}</div>`;

const variant = (ground: string, svg: string, label: string) =>
  `<div><div style="background:${ground};width:200px;height:200px;display:grid;place-items:center">${sized(svg, 168)}</div><div style="margin-top:14px">${label}</div></div>`;

await shoot(
  sheets,
  sheet(24, [
    variant(GROUND.light, SVG["kit-mark.svg"], "light ground"),
    variant(GROUND.dark, SVG["kit-mark-dark.svg"], "dark ground"),
    variant("#ffffff", SVG["kit-mark-black.svg"], "one color"),
    variant(TILE.from, SVG["kit-mark-white.svg"], "reversed"),
  ]),
  920,
  286,
  "kit-mark-variants.png",
);

// Each master magnified with its pixels kept square, then at its true size.
const SIZES: [Master, number, string][] = [
  ["tiny", 16, "16 px: a tab at 1x"],
  ["small", 32, "32 px: a tab at 2x"],
  ["medium", 64, "64 px: launcher icons"],
  ["large", 0, "the logo, 96 px and up"],
];
const columns: string[] = [];
for (const [master, px, note] of SIZES) {
  let views: [string, string];
  if (px) {
    const src = `data:image/png;base64,${(await shoot(icons, sized(tileSvg(master), px), px, px)).toString("base64")}`;
    const img = (w: number) => `<img src="${src}" width="${w}" height="${w}" style="display:block;image-rendering:pixelated">`;
    views = [img(224), img(px)];
  } else {
    views = [sized(SVG["kit-mark.svg"], 224), sized(SVG["kit-mark.svg"], 64)];
  }
  columns.push(
    `<div><b style="font-size:20px;color:#18181b">${master}</b><div>${note}</div><div style="margin:16px 0 24px">${views[0]}</div>${views[1]}</div>`,
  );
}
await shoot(sheets, sheet(32, columns), 1056, 450, "kit-optical-sizes.png");

await browser.close();
