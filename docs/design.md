# Toolbox v2 — Design & Styling Reference

Visual design language, token architecture, contrast invariants, and component conventions for Toolbox v2.

---

## 1. Dual-Layer Styling Architecture

Toolbox v2 uses a two-layer CSS architecture that keeps newer views concise while preserving visual continuity with the older workspace components:

1. **Tailwind CSS v4 Semantic `@theme` Tokens (`src/theme.css`)**:
   - Used by the newer views (`LibraryHomePage`, `SharedLibraryPage`, `NewKitStudioPage`, `KitPathPage`, `DrillsPage`, `ReviewPage`, `AuthGate`) and the `components/settings/*` panels (admin, BYOK, MCP).
   - Controlled via `data-theme="dark"` (default) and `data-theme="light"` on `<html>`.
2. **Legacy CSS Custom Properties & Utility Classes (`src/index.css`)**:
   - Used by the older workspace views (`ChatPage`, `GuidePage`, `BuilderPage`, `StudyPage`, `GraphPage`, `CalculatorPage`, `FeynmanPage`, `InterleavedPage`) and the `SettingsPage` shell. `GuidePage` and `FeynmanPage` also use some `@theme` tokens.
   - Bare-element resets in `src/index.css` are scoped inside `@layer base` so Tailwind v4 utility classes always take precedence cleanly, and `.react-flow svg { max-width: none }` prevents React Flow edge SVGs from collapsing.

---

## 2. Semantic `@theme` Palette (`src/theme.css`)

Every foreground ink, accent, and status token clears **WCAG 2.1 AA (≥ 4.5:1)** against every surface tier in both dark and warm-paper light modes, and `on-primary-wash` / `on-ai-wash` clear it on their `10%` / `15%` / `20%` pill washes over `surface` through `surface-container`. CI enforces this with `src/__tests__/theme_contrast.test.ts` and `npm run audit:contrast`.

| Semantic Token | Tailwind Classes | Dark Value | Role |
|----------------|------------------|------------|------|
| `--color-surface` | `bg-surface` | `#09090b` | Root canvas background |
| `--color-surface-container-lowest` .. `highest` | `bg-surface-container-lowest`, `-low`, `bg-surface-container`, `-high`, `-highest` | `#0d0d12` → `#232330` | Elevated cards, drawers, inputs, hover states |
| `--color-on-surface` | `text-on-surface` | `#f4f4f5` | Primary headings & body copy |
| `--color-on-surface-variant` | `text-on-surface-variant` | `#b0b0bc` | Secondary descriptions & metadata |
| `--color-primary` / `--color-on-primary` | `bg-primary`, `text-primary`, `text-on-primary` | `#93a0ff` / `#0a1026` | Primary CTAs, active indicators, focus rings |
| `--color-on-primary-wash` | `text-on-primary-wash` (paired with `bg-primary/15`) | `#a5b4fc` | AA-compliant text on translucent primary pills |
| `--color-ai` / `--color-on-ai-wash` | `text-ai`, `text-on-ai-wash` (with `bg-ai/15`) | `#c4a8ff` / `#cfb8ff` | AI synthesis, compiler, and coaching accents |
| `--color-outline` / `--color-outline-variant` | `border-outline`, `border-outline-variant` | `#767686` / `#2e2e3d` | Input borders & subtle structural dividers |
| `--color-success` / `--color-warning` / `--color-info` / `--color-danger` | `text-success`, `text-warning`, `text-info`, `text-danger` | `#34d399` / `#fbbf24` / `#60a5fa` / `#ff8a8a` | Mastery, due/caution, informational, and error states |

> **Rule**: `src/theme.css` is the single source of color tokens. After editing colors there, run `npm run audit:contrast` and `npx vitest run src/__tests__/theme_contrast.test.ts`.

---

## 3. Legacy CSS Variables & Component Classes (`src/index.css`)

The older workspace pages consume CSS variables and reusable classes:

- **Colors**: `--color-bg-primary`, `--color-bg-secondary`, `--color-bg-tertiary`, `--color-surface-hover`, `--color-border`, `--color-text-primary`, `--color-text-secondary`, `--color-accent`, `--color-teal`, and the `--color-success-subtle` / `--color-warning-subtle` / `--color-error-subtle` / `--color-info-subtle` washes (`--color-surface` and the solid status colors come from `src/theme.css`)
- **Typography**: `--font-sans` (`Inter`, falling back to the system UI font), `--font-mono` (`JetBrains Mono`), `--text-xs` (`11px`) through `--text-4xl` (`36px`)
- **Spacing & Radii**: 4px grid `--space-1` (`4px`) through `--space-16` (`64px`); `--radius-sm` (`6px`) through `--radius-full` (`9999px`)
- **Core Classes**:
  - Buttons: `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-icon`, `.btn-sm`
  - Containers & Inputs: `.card`, `.card-interactive`, `.input`, `.badge`, `.page-wrapper`, `.page-header`

---

## 4. Constructive Diagrams & Math Rendering

- **Sanitized Inline SVG (`language-svg`)**: Sanitized by `src/utils/sanitizeSvg.ts` and rendered in a responsive Tailwind frame by `SvgFigureRenderer.tsx`. Diagrams inherit `currentColor` and theme surface tokens so schematics remain legible across dark and light modes without hardcoded white backgrounds.
- **Mermaid (`language-mermaid`)**: Rendered via `MermaidRenderer.tsx` (`securityLevel: 'strict'`), switching between Mermaid's built-in `default` and `dark` themes to match `appStore.theme`.
- **KaTeX Math**: Bundled locally (`katex/dist/katex.min.css`) for zero-latency offline equation rendering inside Guide notes, Drills, Flashcards, and Chat.

---

## 5. Responsive Layout & Interaction Conventions

- **Breakpoints**:
  - `< 768px`: Desktop `240px` collapsible `Sidebar` switches to `MobileHeader` and `MobileDrawer`; multi-column workspaces collapse to single-column stacks, and modals widen to 95% of the viewport.
  - Chat panel narrower than `480px` (`@container chat`): header items wrap.
- **Feedback & Icons**:
  - Use `addToast({ type: 'success' | 'error' | 'info', message })` from `useAppStore` — never `window.alert()`.
  - Use `lucide-react` icons at consistent pixel sizes (`14`, `16`, `18`, `20`, `24`).
  - Provide `<EmptyState />` for empty collections and `AbortController` stop controls on all streaming AI views.
