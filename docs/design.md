# Toolbox v2 — Design & Styling Reference

> Canonical specification: see [**`DESIGN.md`**](../DESIGN.md) at the repository root and the live interactive gallery at **`/design-system`** (`src/pages/DesignSystemPage.tsx`).

---

## Quick Engineering Summary

1. **Single Token Source (`src/theme.css`)**:
   - **Dark Mode (Default — Warm Charcoal)**: `--color-surface: #191816`, `--color-surface-card: #22211e`, `--color-on-surface: #ebe7e0`, `--color-primary: #f0a429` (`--color-on-primary: #191816`). Zero `#000000` halation, zero indigo/violet gradients.
   - **Light Mode (Warm Paper)**: `--color-surface: #f5f2ea`, `--color-surface-card: #fcfaf5`, `--color-on-surface: #1e1c19`, `--color-primary: #944905` (`--color-on-primary: #ffffff`).
   - Legacy variables in `src/index.css` (`--color-bg-primary`, `--color-accent`, `--color-text-primary`, etc.) map directly to these warm tokens for visual continuity across all workspace views.
   - Every semantic text/surface/wash pair clears **WCAG 2.1 AA (`>= 4.5:1`)**, enforced in CI by `npm run audit:contrast` and `src/__tests__/theme_contrast.test.ts`.

2. **Strict 4-Purpose Color Law (Von Restorff Effect)**:
   - Chrome stays warm monochrome; color is reserved strictly for:
     1. Kit’s Warm Amber signature & Primary CTA (`--color-primary` / `--color-brand`)
     2. `+/-` Note Diffs (`--color-diff-add-*` sage / `--color-diff-del-*` coral)
     3. Overdue / Failing Memory (`< 70%` retrievability or failed grade)
     4. User 3-Ink Textbook Highlights (`amber`, `sage`, `coral`)

3. **Shared Primitives (`src/components/ui/`)**:
   - `KitLogo`, `KitAvatar` — Canonical Kit the box turtle mark (`scripts/brand/kit.ts` / `docs/brand/`) with `idle`, `thinking`, and `done` companion states.
   - `DomainGlyph`, `resolveKitGlyph` — 1.5px monochrome domain vector glyphs (zero emojis in UI chrome).
   - `Button`, `Kbd`, `HelpHint`, `SegmentedControl`, `SelectPopover`, `ScrubberSlider`, `FluidAccordion`, `StageTransition`.
   - `NotebookSheet`, `DogearCorner`, `HighlightableProse`, `NoteUpdateCard` — Physical notebook mechanics reserved strictly for Guide pages and Flashcards.
   - `AnkiCardStack`, `RetrievabilityRing`, `ForgettingCurve` — Pure Anki review flow (`Space` + `1–4`, zero confidence gate, thinning card stack).
   - `InvitingComposer`, `VoiceWaveform`, `ToastStack`.

4. **Constructive Diagrams, Math & Responsive Conventions**:
   - Sanitized inline SVGs (`src/utils/sanitizeSvg.ts`), strict-mode Mermaid (`MermaidRenderer.tsx`), and local KaTeX (`katex/dist/katex.min.css`).
   - `< 768px` mobile layout switches `Sidebar` to `MobileHeader` + `MobileDrawer`; use `addToast()` from `useAppStore` (never `window.alert()`).
