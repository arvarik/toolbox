/**
 * Canonical semantic `@theme` color palettes for Toolbox v2.
 * Held token-for-token equal to `src/theme.css` and verified against WCAG 2.1 AA
 * (>= 4.5:1) by `src/__tests__/theme_contrast.test.ts`.
 */
export interface ThemePalette {
  primary: string;
  "primary-dim": string;
  "primary-container": string;
  "on-primary": string;
  "on-primary-wash": string;
  ai: string;
  "on-ai-wash": string;
  secondary: string;
  highlight: string;
  success: string;
  warning: string;
  info: string;
  error: string;
  danger: string;
  "on-error": string;
  surface: string;
  "on-surface": string;
  "surface-variant": string;
  "on-surface-variant": string;
  "surface-container-lowest": string;
  "surface-container-low": string;
  "surface-container": string;
  "surface-container-high": string;
  "surface-container-highest": string;
  outline: string;
  "outline-variant": string;
}

export const DARK_PALETTE: ThemePalette = {
  primary: "#93a0ff",
  "primary-dim": "#acb6ff",
  "primary-container": "#2e3678",
  "on-primary": "#0a1026",
  "on-primary-wash": "#a5b4fc",
  ai: "#c4a8ff",
  "on-ai-wash": "#cfb8ff",
  secondary: "#b4b4c0",
  highlight: "#523c12",
  success: "#34d399",
  warning: "#fbbf24",
  info: "#60a5fa",
  error: "#ff8a8a",
  danger: "#ff8a8a",
  "on-error": "#3b0808",
  surface: "#09090b",
  "on-surface": "#f4f4f5",
  "surface-variant": "#272732",
  "on-surface-variant": "#b0b0bc",
  "surface-container-lowest": "#0d0d12",
  "surface-container-low": "#121218",
  "surface-container": "#16161e",
  "surface-container-high": "#1c1c26",
  "surface-container-highest": "#232330",
  outline: "#767686",
  "outline-variant": "#2e2e3d",
};

export const LIGHT_PALETTE: ThemePalette = {
  primary: "#4338ca",
  "primary-dim": "#3730a3",
  "primary-container": "#e0e7ff",
  "on-primary": "#ffffff",
  "on-primary-wash": "#3730a3",
  ai: "#6d28d9",
  "on-ai-wash": "#5b21b6",
  secondary: "#475569",
  highlight: "#fce7a6",
  success: "#046b4e",
  warning: "#944807",
  info: "#036796",
  error: "#bf1b1b",
  danger: "#bf1b1b",
  "on-error": "#ffffff",
  surface: "#f8f6f2",
  "on-surface": "#18181b",
  "surface-variant": "#e5e2db",
  "on-surface-variant": "#4f5259",
  "surface-container-lowest": "#ffffff",
  "surface-container-low": "#f2f1ed",
  "surface-container": "#eceae4",
  "surface-container-high": "#e7e5e0",
  "surface-container-highest": "#e5e2db",
  outline: "#6e717a",
  "outline-variant": "#d4d1cb",
};
