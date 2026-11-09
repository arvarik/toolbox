import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type Rgb = [number, number, number];

function parseTheme(css: string, mode: "dark" | "light"): Record<string, Rgb> {
  const block =
    css.match(new RegExp(`:root\\[data-theme="${mode}"\\]\\s*\\{([^}]+)\\}`))?.[1] ?? "";
  const out: Record<string, Rgb> = {};
  for (const [, key, hex] of block.matchAll(/--color-([a-z-]+):\s*#([0-9a-fA-F]{6});/g)) {
    out[key] = [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
  }
  return out;
}

const lum = ([r, g, b]: Rgb) => {
  const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a: Rgb, b: Rgb) =>
  (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const blend = (fg: Rgb, a: number, bg: Rgb): Rgb => [
  fg[0] * a + bg[0] * (1 - a),
  fg[1] * a + bg[1] * (1 - a),
  fg[2] * a + bg[2] * (1 - a),
];

const SURFACES = [
  "surface",
  "surface-container-lowest",
  "surface-container-low",
  "surface-container",
  "surface-container-high",
  "surface-container-highest",
];
const PILL_SURFACES = SURFACES.slice(0, 4);
const TEXT_TOKENS = [
  "on-surface",
  "on-surface-variant",
  "primary",
  "ai",
  "secondary",
  "success",
  "warning",
  "info",
  "error",
  "danger",
];

describe("Tailwind v4 semantic @theme WCAG 2.1 AA contrast", () => {
  const css = fs.readFileSync(path.resolve(import.meta.dirname, "../theme.css"), "utf8");

  for (const mode of ["dark", "light"] as const) {
    const p = parseTheme(css, mode);

    it(`clears 4.5:1 for all text tokens, buttons, and pill washes in ${mode} mode`, () => {
      for (const s of SURFACES) {
        for (const t of TEXT_TOKENS) {
          expect(contrast(p[t], p[s]), `${mode}: ${t} on ${s}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(contrast(p["on-primary"], p.primary)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p["on-error"], p.error)).toBeGreaterThanOrEqual(4.5);
      for (const s of PILL_SURFACES) {
        for (const a of [0.1, 0.15, 0.2]) {
          expect(
            contrast(p["on-primary-wash"], blend(p.primary, a, p[s])),
          ).toBeGreaterThanOrEqual(4.5);
          expect(contrast(p["on-ai-wash"], blend(p.ai, a, p[s]))).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }
});
