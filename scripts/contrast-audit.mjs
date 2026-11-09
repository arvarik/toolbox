#!/usr/bin/env node
// Zero-dependency static WCAG 2.1 AA contrast scanner for Toolbox
// (`src/theme.css` + `src/**/*.{ts,tsx,jsx}`).
// 1. Parses semantic color tokens from `src/theme.css` (`@theme`, `:root[data-theme="dark"]`, `:root[data-theme="light"]`).
// 2. Audits semantic surface/ink/button/pill-wash token matrices in both dark and light modes.
// 3. Statically scans JSX/TSX `className` combinations across `src/**/*.{ts,tsx,jsx}` (including ternary
//    branches, hover/focus overrides, and `/alpha` opacity washes) for WCAG 2.1 AA violations
//    (< 4.5:1 normal text, < 3.0:1 large text).

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const THEME_CSS_PATH = path.resolve(ROOT, "src/theme.css");
const SRC_DIR = path.resolve(ROOT, "src");

const BUILTIN_COLORS = {
  white: "#ffffff",
  black: "#000000",
  "zinc-50": "#fafafa",
  "zinc-100": "#f4f4f5",
  "zinc-200": "#e4e4e7",
  "zinc-300": "#d4d4d8",
  "zinc-400": "#a1a1aa",
  "zinc-500": "#71717a",
  "zinc-600": "#52525b",
  "zinc-700": "#3f3f46",
  "zinc-800": "#27272a",
  "zinc-900": "#18181b",
  "zinc-950": "#09090b",
  "slate-50": "#f8fafc",
  "slate-100": "#f1f5f9",
  "slate-200": "#e2e8f0",
  "slate-300": "#cbd5e1",
  "slate-400": "#94a3b8",
  "slate-500": "#64748b",
  "slate-600": "#475569",
  "slate-700": "#334155",
  "slate-800": "#1e293b",
  "slate-900": "#0f172a",
  "indigo-50": "#eef2ff",
  "indigo-100": "#e0e7ff",
  "indigo-200": "#c7d2fe",
  "indigo-300": "#a5b4fc",
  "indigo-400": "#818cf8",
  "indigo-500": "#6366f1",
  "indigo-600": "#4f46e5",
  "indigo-700": "#4338ca",
  "indigo-800": "#3730a3",
  "indigo-900": "#312e81",
  "emerald-400": "#34d399",
  "emerald-500": "#10b981",
  "emerald-600": "#059669",
  "emerald-700": "#047857",
  "amber-300": "#fcd34d",
  "amber-400": "#fbbf24",
  "amber-500": "#f59e0b",
  "amber-700": "#b45309",
  "amber-800": "#92400e",
  "red-400": "#f87171",
  "red-500": "#ef4444",
  "red-600": "#dc2626",
  "red-700": "#b91c1c",
  "sky-400": "#38bdf8",
  "sky-500": "#0ea5e9",
  "sky-700": "#0369a1",
  "violet-300": "#c4b5fd",
  "violet-400": "#a78bfa",
  "violet-600": "#7c3aed",
  "violet-700": "#6d28d9",
};

const NON_COLOR_TEXT_UTILITIES = new Set([
  "xs",
  "sm",
  "base",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
  "5xl",
  "6xl",
  "7xl",
  "8xl",
  "9xl",
  "left",
  "center",
  "right",
  "justify",
  "start",
  "end",
  "wrap",
  "nowrap",
  "balance",
  "pretty",
  "ellipsis",
  "clip",
  "inherit",
  "current",
  "transparent",
]);

const NON_COLOR_BG_UTILITIES = new Set([
  "none",
  "transparent",
  "current",
  "inherit",
  "auto",
  "cover",
  "contain",
  "fixed",
  "local",
  "scroll",
  "center",
  "top",
  "bottom",
  "left",
  "right",
  "repeat",
  "no-repeat",
  "clip-border",
  "clip-padding",
  "clip-content",
  "clip-text",
]);

export function hexToRgb(hex) {
  const clean = hex.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(clean)) {
    return [
      Number.parseInt(clean[0] + clean[0], 16),
      Number.parseInt(clean[1] + clean[1], 16),
      Number.parseInt(clean[2] + clean[2], 16),
    ];
  }
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
    return null;
  }
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ];
}

export function blendOver(fg, alpha, bg) {
  return [
    fg[0] * alpha + bg[0] * (1 - alpha),
    fg[1] * alpha + bg[1] * (1 - alpha),
    fg[2] * alpha + bg[2] * (1 - alpha),
  ];
}

export function relativeLuminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a, b) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseColorDecls(blockText, fallbackMap = {}) {
  const raw = {};
  const declRe = /--color-([a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m;
  while ((m = declRe.exec(blockText)) !== null) {
    raw[m[1]] = m[2].trim();
  }
  const resolved = { ...BUILTIN_COLORS, ...fallbackMap };
  for (const [k, v] of Object.entries(raw)) {
    const varMatch = v.match(/^var\(--color-([a-z0-9-]+)\)$/i);
    if (varMatch && (raw[varMatch[1]] || resolved[varMatch[1]])) {
      resolved[k] = raw[varMatch[1]] || resolved[varMatch[1]];
    } else {
      resolved[k] = v;
    }
  }
  return resolved;
}

function parsePairOverrides(css) {
  const overrides = { dark: new Map(), light: new Map() };
  const ruleRe = /([^{}]+)\{([^}]+)\}/g;
  let m;
  while ((m = ruleRe.exec(css)) !== null) {
    const selectors = m[1].split(",").map((s) => s.trim());
    const colorMatch = m[2].match(/(?:^|;)\s*color\s*:\s*(#[0-9a-fA-F]{3,6})\s*;/);
    if (!colorMatch) continue;
    const hex = colorMatch[1];
    for (const sel of selectors) {
      const themeMatch = sel.match(/:root\[data-theme="(dark|light)"\]/);
      const bgMatch = sel.match(/\.bg-([a-z0-9-]+)(?:\\\/(\d+))?/);
      const fgMatch = sel.match(/\.text-([a-z0-9-]+)/);
      if (themeMatch && bgMatch && fgMatch) {
        const mode = themeMatch[1];
        const bgKey = bgMatch[2] ? `${bgMatch[1]}/${bgMatch[2]}` : bgMatch[1];
        overrides[mode].set(`${bgKey}|${fgMatch[1]}`, hex);
      }
    }
  }
  return overrides;
}

export function loadThemePalettes(cssPath = THEME_CSS_PATH) {
  const css = fs.readFileSync(cssPath, "utf8");
  const themeBlock = css.match(/@theme\s*\{([^}]+)\}/)?.[1] ?? "";
  const darkBlock =
    css.match(/:root\[data-theme="dark"\]\s*\{([^}]+)\}/)?.[1] ?? "";
  const lightBlock =
    css.match(/:root\[data-theme="light"\]\s*\{([^}]+)\}/)?.[1] ?? "";

  const base = parseColorDecls(themeBlock);
  const dark = parseColorDecls(darkBlock, base);
  const light = parseColorDecls(lightBlock, base);
  const pairOverrides = parsePairOverrides(css);
  return { base, dark, light, pairOverrides };
}

function auditSemanticPalettes(palettes) {
  const violations = [];
  const surfaces = [
    "surface",
    "surface-container-lowest",
    "surface-container-low",
    "surface-container",
    "surface-container-high",
    "surface-container-highest",
  ];
  const pillSurfaces = [
    "surface",
    "surface-container-lowest",
    "surface-container-low",
    "surface-container",
  ];
  const textTokens = [
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

  for (const [mode, palette] of [
    ["dark", palettes.dark],
    ["light", palettes.light],
  ]) {
    for (const surfaceKey of surfaces) {
      const bg = hexToRgb(palette[surfaceKey] || "");
      if (!bg) continue;
      for (const textKey of textTokens) {
        const fg = hexToRgb(palette[textKey] || "");
        if (!fg) continue;
        const ratio = contrastRatio(fg, bg);
        if (ratio < 4.5) {
          violations.push({
            file: "src/theme.css",
            line: 1,
            mode,
            pair: `text-${textKey} on bg-${surfaceKey}`,
            ratio,
            threshold: 4.5,
          });
        }
      }
    }

    for (const [fgKey, bgKey] of [
      ["on-primary", "primary"],
      ["on-error", "error"],
    ]) {
      const fg = hexToRgb(palette[fgKey] || "");
      const bg = hexToRgb(palette[bgKey] || "");
      if (fg && bg) {
        const ratio = contrastRatio(fg, bg);
        if (ratio < 4.5) {
          violations.push({
            file: "src/theme.css",
            line: 1,
            mode,
            pair: `text-${fgKey} on bg-${bgKey}`,
            ratio,
            threshold: 4.5,
          });
        }
      }
    }

    for (const surfaceKey of pillSurfaces) {
      const surface = hexToRgb(palette[surfaceKey] || "");
      if (!surface) continue;
      for (const alpha of [0.1, 0.15, 0.2]) {
        for (const [fgKey, washKey] of [
          ["on-primary-wash", "primary"],
          ["on-ai-wash", "ai"],
        ]) {
          const fg = hexToRgb(palette[fgKey] || "");
          const wash = hexToRgb(palette[washKey] || "");
          if (!fg || !wash) continue;
          const blendedBg = blendOver(wash, alpha, surface);
          const ratio = contrastRatio(fg, blendedBg);
          if (ratio < 4.5) {
            violations.push({
              file: "src/theme.css",
              line: 1,
              mode,
              pair: `text-${fgKey} on bg-${washKey}/${Math.round(alpha * 100)} (over ${surfaceKey})`,
              ratio,
              threshold: 4.5,
            });
          }
        }
      }
    }
  }
  return violations;
}

function lineNumberAt(source, index) {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
}

function skipBalancedTemplate(source, startAfterTick) {
  let i = startAfterTick;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "`") {
      return i + 1;
    }
    if (ch === "$" && source[i + 1] === "{") {
      i = skipBalancedBraceExpr(source, i + 2);
      continue;
    }
    i++;
  }
  return i;
}

function skipBalancedBraceExpr(source, startAfterOpenBrace) {
  let depth = 1;
  let i = startAfterOpenBrace;
  while (i < source.length && depth > 0) {
    const c = source[i];
    if (c === '"' || c === "'") {
      const q = c;
      i++;
      while (i < source.length) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === q) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "`") {
      i = skipBalancedTemplate(source, i + 1);
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    i++;
  }
  return i;
}

// Extracts resolved className string combinations from JSX/TSX source:
// - `className="..."` / `className='...'` -> single combination
// - `className={...}` -> combines static outer template literal text (if any) with each
//   inner string literal branch individually so mutually exclusive ternary branches do not collide.
export function extractClassCombinations(source) {
  const results = [];
  const attrRe = /\bclassName\s*=\s*/g;
  let match;

  while ((match = attrRe.exec(source)) !== null) {
    let idx = match.index + match[0].length;
    while (idx < source.length && /\s/.test(source[idx])) idx++;
    const line = lineNumberAt(source, match.index);
    const ch = source[idx];

    if (ch === '"' || ch === "'") {
      const quote = ch;
      let end = idx + 1;
      let val = "";
      while (end < source.length && source[end] !== quote) {
        if (source[end] === "\\") {
          val += source[end + 1] ?? "";
          end += 2;
          continue;
        }
        val += source[end];
        end++;
      }
      if (val.trim()) {
        results.push({ line, classes: val.trim() });
      }
      attrRe.lastIndex = end + 1;
      continue;
    }

    if (ch === "{") {
      const end = skipBalancedBraceExpr(source, idx + 1);
      const expr = source.slice(idx + 1, end - 1).trim();
      for (const combo of expandClassExpr(expr)) {
        if (combo.trim()) {
          results.push({ line, classes: combo.trim() });
        }
      }
      attrRe.lastIndex = end;
    }
  }

  // Also scan standalone helper string literals (e.g. `cls: "bg-... text-..."`, badge maps)
  const strRe = /(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  let strMatch;
  while ((strMatch = strRe.exec(source)) !== null) {
    const val = strMatch[2].trim();
    if (val.includes("bg-") && val.includes("text-") && !val.includes("${")) {
      results.push({
        line: lineNumberAt(source, strMatch.index),
        classes: val,
      });
    }
  }

  return results;
}

function extractQuotedStrings(expr) {
  const literals = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (c === '"' || c === "'") {
      const q = c;
      let val = "";
      i++;
      while (i < expr.length && expr[i] !== q) {
        if (expr[i] === "\\") {
          val += expr[i + 1] ?? "";
          i += 2;
          continue;
        }
        val += expr[i];
        i++;
      }
      i++;
      literals.push(val);
      continue;
    }
    if (c === "`") {
      let staticQuasi = "";
      const nestedBranches = [];
      i++;
      while (i < expr.length && expr[i] !== "`") {
        if (expr[i] === "\\") {
          staticQuasi += expr[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (expr[i] === "$" && expr[i + 1] === "{") {
          const j = skipBalancedBraceExpr(expr, i + 2);
          const subExpr = expr.slice(i + 2, j - 1);
          const subLiterals = extractQuotedStrings(subExpr);
          if (subLiterals.length > 0) {
            nestedBranches.push(subLiterals);
          }
          staticQuasi += " ";
          i = j;
          continue;
        }
        staticQuasi += expr[i];
        i++;
      }
      i++;
      if (nestedBranches.length === 0) {
        literals.push(staticQuasi);
      } else {
        literals.push(staticQuasi);
        for (const group of nestedBranches) {
          for (const branch of group) {
            literals.push(`${staticQuasi} ${branch}`);
          }
        }
      }
      continue;
    }
    i++;
  }
  return literals;
}

function expandClassExpr(expr) {
  return extractQuotedStrings(expr);
}

function parseColorUtility(rawToken, prefix) {
  if (!rawToken.startsWith(prefix)) return null;
  const body = rawToken.slice(prefix.length);
  if (!body || body.startsWith("[") && !/^\[#[0-9a-fA-F]{3,6}\]/.test(body)) {
    return null;
  }
  const slashIdx = body.indexOf("/");
  const name = slashIdx === -1 ? body : body.slice(0, slashIdx);
  const alphaStr = slashIdx === -1 ? null : body.slice(slashIdx + 1);

  if (prefix === "text-" && NON_COLOR_TEXT_UTILITIES.has(name)) return null;
  if (
    prefix === "bg-" &&
    (NON_COLOR_BG_UTILITIES.has(name) ||
      name.startsWith("gradient-") ||
      name.startsWith("linear-"))
  ) {
    return null;
  }

  let alpha = 1;
  if (alphaStr !== null) {
    const num = Number(alphaStr);
    if (!Number.isFinite(num)) return null;
    alpha = num > 1 ? Math.min(1, Math.max(0, num / 100)) : Math.min(1, Math.max(0, num));
  }

  return { name, alpha };
}

function resolveColorRgb(colorName, palette) {
  if (colorName.startsWith("[#") && colorName.endsWith("]")) {
    return hexToRgb(colorName.slice(1, -1));
  }
  const hex = palette[colorName];
  if (!hex) return null;
  return hexToRgb(hex);
}

function isLargeTextClassList(tokens) {
  const bare = tokens.map((t) => t.split(":").pop());
  const hasXlPlus = bare.some((t) =>
    ["text-xl", "text-2xl", "text-3xl", "text-4xl", "text-5xl", "text-6xl"].includes(
      t,
    ),
  );
  if (hasXlPlus) return true;
  const hasLg = bare.includes("text-lg");
  const isBold = bare.some((t) =>
    ["font-semibold", "font-bold", "font-extrabold", "font-black"].includes(t),
  );
  return hasLg && isBold;
}

export function auditClassCombination(classes, palettes, meta) {
  const tokens = classes.split(/\s+/).filter(Boolean);
  const bareSet = new Set(tokens.map((t) => t.split(":").pop()));
  if (
    bareSet.has("sr-only") ||
    bareSet.has("invisible") ||
    bareSet.has("opacity-0") ||
    bareSet.has("text-transparent") ||
    bareSet.has("bg-clip-text")
  ) {
    return [];
  }

  const threshold = isLargeTextClassList(tokens) ? 3.0 : 4.5;
  const states = {
    base: { bg: null, fg: null },
    hover: { bg: null, fg: null },
    focus: { bg: null, fg: null },
  };

  for (const tok of tokens) {
    const parts = tok.split(":");
    const utility = parts[parts.length - 1];
    const modifiers = parts.slice(0, -1);

    if (
      modifiers.includes("disabled") ||
      modifiers.includes("placeholder") ||
      modifiers.includes("selection")
    ) {
      continue;
    }

    let bucket = "base";
    if (modifiers.some((m) => m === "hover" || m === "group-hover")) {
      bucket = "hover";
    } else if (
      modifiers.some((m) => m === "focus" || m === "focus-visible" || m === "active")
    ) {
      bucket = "focus";
    } else if (modifiers.some((m) => m === "dark")) {
      // Handled only in dark mode; skip cross-mode false positives
      continue;
    }

    const bgParsed = parseColorUtility(utility, "bg-");
    if (bgParsed) states[bucket].bg = bgParsed;
    const fgParsed = parseColorUtility(utility, "text-");
    if (fgParsed) states[bucket].fg = fgParsed;
  }

  const pairsToCheck = [];
  if (states.base.bg && states.base.fg) {
    pairsToCheck.push({ state: "base", bg: states.base.bg, fg: states.base.fg });
  }
  for (const interactive of ["hover", "focus"]) {
    const st = states[interactive];
    if (!st.bg && !st.fg) continue;
    const effBg = st.bg ?? states.base.bg;
    const effFg = st.fg ?? states.base.fg;
    if (effBg && effFg) {
      pairsToCheck.push({ state: interactive, bg: effBg, fg: effFg });
    }
  }

  const violations = [];
  for (const check of pairsToCheck) {
    for (const [mode, palette] of [
      ["dark", palettes.dark],
      ["light", palettes.light],
    ]) {
      const rawBg = resolveColorRgb(check.bg.name, palette);
      const overrideKey = `${
        check.bg.alpha < 1
          ? `${check.bg.name}/${Math.round(check.bg.alpha * 100)}`
          : check.bg.name
      }|${check.fg.name}`;
      const overrideHex = palettes.pairOverrides?.[mode]?.get(overrideKey);
      const rawFg = overrideHex
        ? hexToRgb(overrideHex)
        : resolveColorRgb(check.fg.name, palette);
      if (!rawBg || !rawFg) continue;

      const backdropNames =
        check.bg.alpha < 1 ? ["surface", "surface-container-low"] : ["surface"];

      let worstRatio = Infinity;
      let worstBackdrop = "surface";
      for (const backdropName of backdropNames) {
        const backdrop =
          hexToRgb(palette[backdropName] || "") ??
          (mode === "dark" ? [9, 9, 11] : [248, 246, 242]);
        const effBg =
          check.bg.alpha < 1 ? blendOver(rawBg, check.bg.alpha, backdrop) : rawBg;
        const effFg =
          check.fg.alpha < 1 ? blendOver(rawFg, check.fg.alpha, effBg) : rawFg;
        const ratio = contrastRatio(effFg, effBg);
        if (ratio < worstRatio) {
          worstRatio = ratio;
          worstBackdrop = backdropName;
        }
      }

      if (worstRatio < threshold) {
        const bgLabel =
          check.bg.alpha < 1
            ? `bg-${check.bg.name}/${Math.round(check.bg.alpha * 100)} (over ${worstBackdrop})`
            : `bg-${check.bg.name}`;
        const fgLabel =
          check.fg.alpha < 1
            ? `text-${check.fg.name}/${Math.round(check.fg.alpha * 100)}`
            : `text-${check.fg.name}`;
        violations.push({
          file: meta.file,
          line: meta.line,
          mode,
          state: check.state,
          pair: `${fgLabel} on ${bgLabel}`,
          ratio: worstRatio,
          threshold,
        });
      }
    }
  }

  return violations;
}

function walkSourceFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      walkSourceFiles(full, acc);
    } else if (
      /\.(?:ts|tsx|jsx)$/.test(entry.name) &&
      !/\.(?:test|spec)\.(?:ts|tsx|jsx)$/.test(entry.name)
    ) {
      acc.push(full);
    }
  }
  return acc;
}

export function runContrastAudit() {
  const palettes = loadThemePalettes(THEME_CSS_PATH);
  const violations = [...auditSemanticPalettes(palettes)];
  const files = walkSourceFiles(SRC_DIR);
  let scannedPairs = 0;

  for (const absFile of files) {
    const relFile = path.relative(ROOT, absFile).replace(/\\/g, "/");
    const source = fs.readFileSync(absFile, "utf8");
    const combos = extractClassCombinations(source);
    const seenAtLine = new Set();
    for (const combo of combos) {
      const dedupKey = `${combo.line}:${combo.classes}`;
      if (seenAtLine.has(dedupKey)) continue;
      seenAtLine.add(dedupKey);
      scannedPairs++;
      const found = auditClassCombination(combo.classes, palettes, {
        file: relFile,
        line: combo.line,
      });
      violations.push(...found);
    }
  }

  return { filesScanned: files.length, scannedPairs, violations };
}

function main() {
  const { filesScanned, scannedPairs, violations } = runContrastAudit();
  if (violations.length > 0) {
    const seen = new Set();
    const unique = violations.filter((v) => {
      const k = `${v.file}:${v.line}:${v.mode}:${v.state ?? "token"}:${v.pair}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    for (const v of unique) {
      const stateTag = v.state && v.state !== "base" ? ` [${v.state}]` : "";
      console.error(
        `${v.file}:${v.line}  [${v.mode}]${stateTag}  ${v.pair}  ratio=${v.ratio.toFixed(2)}:1 < ${v.threshold.toFixed(1)}:1`,
      );
    }
    console.error(
      `\ncontrast-audit: ${unique.length} WCAG 2.1 AA violation(s) across ${filesScanned} files.`,
    );
    process.exit(1);
  }

  console.log(
    `contrast-audit: clean (${filesScanned} files, ${scannedPairs} class combinations, dark + light WCAG 2.1 AA verified)`,
  );
}

if (
  process.argv[1] &&
  import.meta.url.endsWith(path.basename(process.argv[1]))
) {
  main();
}
