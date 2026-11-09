import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DARK_PALETTE,
  LIGHT_PALETTE,
  type ThemePalette,
} from "../lib/themePalette.ts";

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
    throw new Error(`Invalid 6-digit hex color: ${hex}`);
  }
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ];
}

function blendOver(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return [
    fg[0] * alpha + bg[0] * (1 - alpha),
    fg[1] * alpha + bg[1] * (1 - alpha),
    fg[2] * alpha + bg[2] * (1 - alpha),
  ];
}

function relativeLuminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const SURFACES: Array<keyof ThemePalette> = [
  "surface",
  "surface-container-lowest",
  "surface-container-low",
  "surface-container",
  "surface-container-high",
  "surface-container-highest",
];

const PILL_SURFACES: Array<keyof ThemePalette> = [
  "surface",
  "surface-container-lowest",
  "surface-container-low",
  "surface-container",
];

const TEXT_TOKENS: Array<keyof ThemePalette> = [
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

const WASH_ALPHAS = [0.1, 0.15, 0.2] as const;

describe("Tailwind v4 semantic @theme WCAG 2.1 AA contrast", () => {
  for (const [mode, palette] of [
    ["dark", DARK_PALETTE],
    ["light", LIGHT_PALETTE],
  ] as const) {
    it(`clears 4.5:1 for all text tokens across all 6 surfaces in ${mode} mode`, () => {
      for (const surfaceKey of SURFACES) {
        const bg = hexToRgb(palette[surfaceKey]);
        for (const textKey of TEXT_TOKENS) {
          const fg = hexToRgb(palette[textKey]);
          const ratio = contrastRatio(fg, bg);
          expect(
            ratio,
            `${mode}: ${textKey} (${palette[textKey]}) on ${surfaceKey} (${palette[surfaceKey]}) = ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it(`clears 4.5:1 for button labels (on-primary/on-error) and wash pills in ${mode} mode`, () => {
      expect(
        contrastRatio(hexToRgb(palette["on-primary"]), hexToRgb(palette.primary)),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(hexToRgb(palette["on-error"]), hexToRgb(palette.error)),
      ).toBeGreaterThanOrEqual(4.5);

      for (const surfaceKey of PILL_SURFACES) {
        const surface = hexToRgb(palette[surfaceKey]);
        for (const alpha of WASH_ALPHAS) {
          const primaryWash = blendOver(hexToRgb(palette.primary), alpha, surface);
          expect(
            contrastRatio(hexToRgb(palette["on-primary-wash"]), primaryWash),
            `${mode}: on-primary-wash on primary/${alpha * 100}% over ${surfaceKey}`,
          ).toBeGreaterThanOrEqual(4.5);

          const aiWash = blendOver(hexToRgb(palette.ai), alpha, surface);
          expect(
            contrastRatio(hexToRgb(palette["on-ai-wash"]), aiWash),
            `${mode}: on-ai-wash on ai/${alpha * 100}% over ${surfaceKey}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }

  it("keeps src/theme.css and src/lib/themePalette.ts synchronized token-for-token", () => {
    const cssPath = path.resolve(import.meta.dirname, "../theme.css");
    const css = fs.readFileSync(cssPath, "utf8");

    const darkBlock = css.match(/:root\[data-theme="dark"\]\s*\{([^}]+)\}/)?.[1] ?? "";
    const lightBlock = css.match(/:root\[data-theme="light"\]\s*\{([^}]+)\}/)?.[1] ?? "";

    for (const [key, expected] of Object.entries(DARK_PALETTE)) {
      expect(darkBlock).toContain(`--color-${key}: ${expected};`);
    }
    for (const [key, expected] of Object.entries(LIGHT_PALETTE)) {
      expect(lightBlock).toContain(`--color-${key}: ${expected};`);
    }
  });
});
