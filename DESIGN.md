# Toolbox v2 — Design System (`DESIGN.md`)

**Tactile Notebook & Precision Hardware** — Canonical visual language, token architecture, Laws of UX (`lawsofux.com`), and component conventions for Toolbox v2 (**Tools for Thought**).

> Interactive live specimen gallery: navigate to **`/design-system`** in the app (`src/pages/DesignSystemPage.tsx`), backed by `src/components/ui/`.

---

## 1. Design North Star

Toolbox blends the calm spatial clarity of **Codex** and **Linear** with the warmth of a **well-kept desk notebook**:

1. **Zero AI-Slop**: No indigo/violet gradients, no glowing neon borders, no decorative emojis in chrome, no verbose instructional banners, and no rounded chat-bubble clutter.
2. **Warm Eye-Safe Surfaces**: Dark mode uses warm charcoal desk-lamp slate (`#191816`) and soft parchment ink (`#ebe7e0`) to eliminate `#000000` OLED halation during multi-hour study sessions. Light mode uses warm textbook paper (`#f5f2ea` / `#fcfaf5`).
3. **Tactile Restraint**: Physical notebook cues (`.notebook-sheet`, folded dogears, 3-ink highlights, thinning index-card stacks) appear **only** on reading pages and flashcards — never on sidebars, settings, or toolbars.
4. **Living Hardware Feedback**: Controls respond within `<200ms` with tactile `scale(0.97)` presses, spring-tracked tabs, magnetic graph crosshairs, connected-node hover illumination, and elastic scrubbers.

---

## 2. Color System & The 4-Purpose Color Law (Von Restorff Effect)

Over **90%** of application chrome is warm monochrome (`surface`, `ink`, hairline alpha rules). Color is strictly earned and reserved for **four semantic purposes**:

1. **Kit’s Signature & Primary Action** (`--color-primary` / `--color-brand`): Warm amber (`#f0a429` dark / `#944905` light), echoing the amber eye of a male eastern box turtle.
2. **Note Update Diffs** (`--color-diff-add-*` / `--color-diff-del-*`): Soft sage for additions and muted coral for removals when reviewing Guide commits.
3. **Overdue or Failing Recall** (`--color-error` / `--color-danger`): Surfaces only when retrievability drops below `70%` (`<RetrievabilityRing />`) or on `Again` / error states. Healthy mastery rings stay calm monochrome.
4. **User Textbook Highlights** (`.hl-amber`, `.hl-sage`, `.hl-coral`): Muted analog highlighter washes applied by the learner inside Study Guide prose.

### WCAG 2.1 AA Invariant (`>= 4.5:1`)

`src/theme.css` is the single source of truth for semantic tokens. Every foreground, accent, and status token clears **WCAG 2.1 AA (`>= 4.5:1`)** against all six surface tiers (`surface` through `surface-container-highest`) and `10%` / `15%` / `20%` translucent washes in both dark and light modes.

| Token | Dark (`data-theme="dark"`) | Light (`data-theme="light"`) | Role |
|-------|----------------------------|------------------------------|------|
| `--color-surface` | `#191816` | `#f5f2ea` | Root workspace desk canvas |
| `--color-surface-container-lowest` | `#141311` | `#fcfaf5` | Recessed rail (dark) / brightest sheet (light) |
| `--color-surface-card` / `container` | `#22211e` | `#fcfaf5` / `#e9e3d7` | Raised `.notebook-sheet` & cards |
| `--color-surface-elevated` / `high` | `#292723` / `#272521` | `#e4dfd2` / `#e4ded1` | Buttons, popovers, active pills |
| `--color-on-surface` / `--color-ink` | `#ebe7e0` | `#1e1c19` | Primary prose & headings (~89% dark luminance) |
| `--color-on-surface-variant` / `--color-ink-muted` | `#b5afa4` | `#4f4a42` | Secondary copy & metadata |
| `--color-ink-faint` | `#a39d92` | `#59534a` | Keycaps, timestamps, captions (still `>= 4.8:1` AA) |
| `--color-primary` / `--color-on-primary` | `#f0a429` / `#191816` | `#944905` / `#ffffff` | Primary CTAs, focus rings, Kit’s amber eye |
| `--color-success` / `--color-error` | `#6fbf94` / `#f08c82` | `#166241` / `#a82419` | Diffs, mastery verification, overdue alerts |

Always verify token and class edits with:

```bash
npm run audit:contrast
npx vitest run src/__tests__/theme_contrast.test.ts
```

---

## 3. Typography, Iconography & Brevity

- **Editorial Serif (`--font-serif`)**: `"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Charter, Georgia, serif` — used strictly for Kit/Guide titles, notebook section headings, and flashcard prompts to establish a calm reading voice.
- **UI & Prose Sans (`--font-sans`)**: `"Inter", -apple-system, BlinkMacSystemFont, sans-serif` at `15px–15.5px` with generous `1.6–1.72` line-height and `65ch–72ch` max measure on reading sheets.
- **Precision Mono (`--font-mono`)**: `"JetBrains Mono", "SF Mono", monospace` with `font-variant-numeric: tabular-nums` for FSRS intervals, keyboard shortcuts (`<Kbd />`), and Back-of-the-Envelope formulas.
- **Zero Emojis in Chrome**: Never use Unicode emojis (`📚`, `📦`, `🎯`, `⚙️`) as UI icons. Use `<KitLogo />`, `<DomainGlyph />` (`resolveKitGlyph()`), or `lucide-react` `1.5px` stroke icons (`14px`–`20px`).
- **Radical Brevity (Miller’s Law)**: Subtitles and empty-state descriptions must stay **14 words or fewer**. Put optional explanations inside `<HelpHint text="..." />` (`?` popover) instead of permanent paragraphs.
- **Plain Human Language**: Prefer *"My Kits"*, *"Guide"*, *"Review"*, *"Updates"*, and *"Credits foundations"* over internal jargon in primary navigation and banners.

---

## 4. Kit the Box Turtle — Living Companion

Kit (canonical vector master in `scripts/brand/kit.ts` and `docs/brand/`) is the learner’s Socratic companion across Chat, Guide synthesis, and Review completion:

- **Presence in Chat**: AI responses are authored by **Kit** with `<KitAvatar state="idle" | "thinking" | "done" />` in clean editorial blocks (never heavycolored speech bubbles).
- **Living Micro-States**:
  - `idle`: Warm monochrome shell + subtle periodic amber eye blink (`animate-kit-blink`).
  - `thinking`: Gentle shell tuck/breath (`animate-kit-thinking`) while streaming or searching notes.
  - `done`: Appears on the calm *"All caught up"* completion sheet when the review queue reaches zero.

---

## 5. Physical Notebook Mechanics

Persisted per user and Kit in SQLite (`guide_dogears`, `guide_highlights`, `kits.last_guide_ref`) and portable inside `.toolbox-backup.zip` archives:

1. **`.notebook-sheet` (`<NotebookSheet />`)**: Warm card ground, `1px` hairline border, and subtle sheet shadow. Reserved strictly for active reading and recall sheets (Guide pages, Notebook Inspector previews, Flashcards, and Feynman recall prompts — never navigation chrome, modals, or dashboards).
2. **Folded Corner Dogears (`<DogearCorner />`)**: Top-right corner peels slightly on hover and folds with a crisp `<180ms` spring on click (`POST /api/guide-content/dogears/toggle`), powering a 1-click **Dogeared** filter in the Guide spine.
3. **3-Ink Highlighter (`<HighlightableProse />`)**: Selecting any phrase in a Guide section opens a compact floating **`Highlight (Amber · Sage · Coral) · Make Card · Ask Kit`** bar. Saved highlights render with organic analog marker edges (`.hl-mark`) without dimming surrounding text.
4. **Automatic Reading Resume**: Opening a Guide topic records `last_guide_ref` (`PUT /api/guide-content/resume`), surfacing a 1-click resume link on **My Study Library** and the workspace spine.
5. **Clean Note Updates (`<NoteUpdateCard />`)**: AI-proposed Guide commits present concise summary bullets first, with raw `+/-` line diffs tucked behind an optional **`Show diff`** `<FluidAccordion />`.

---

## 6. Pure Anki Review Flow

 Flashcard review (`ReviewPage`, `FlashcardView`, `<AnkiCardStack />`) follows a frictionless **Anki** loop:

- **No Pre-Reveal Confidence Gate**: Never block card reveal behind Low/Medium/High confidence buttons (`confidence` defaults silently to `"medium"` on the API).
- **Thinning Physical Stack (Goal-Gradient Effect)**: Up to 3 subtle stacked card edges appear beneath the active `.notebook-sheet` and physically thin down as remaining cards approach `0`.
- **0ms Keyboard Loop (Doherty Threshold)**: `Space` flips the card (`<200ms` reveal); `1` (`Again`), `2` (`Hard`), `3` (`Good`), and `4` (`Easy`) rate immediately with projected FSRS-6 intervals shown above each button.
- **Optional Scratch Input**: A quiet *"Type answer"* toggle lets learners jot a 1-line commitment before flipping when desired, hidden by default.

---

## 7. Laws of UX Checklist (`lawsofux.com`)

| Law | Application in Toolbox v2 |
|-----|---------------------------|
| **Hick’s Law** | Maximum **3** starter prompt pills on empty chat threads; secondary actions tucked into `+` or `⋯` menus. |
| **Fitts’s Law** | Generous multi-line `<InvitingComposer />` centered vertically on fresh sessions, gliding smoothly to the bottom once active; wide 4-column Anki grade targets. |
| **Miller’s Law** | `<= 14`-word helper copy; progressive disclosure via `<HelpHint />` and `Show diff` accordions. |
| **Jakob’s Law** | Familiar Codex/Linear 3-pane workspace (`Left Curriculum · Center Stage · Right Inspector`), `⌘/` search palette, and Anki `Space` + `1–4` grading. |
| **Von Restorff Effect** | Monochrome chrome so Kit’s amber CTA, `+/-` diffs, `<70%` overdue rings, and 3-ink highlights carry immediate signal. |
| **Doherty Threshold** | Instant optimistic dogears/highlights, `0ms` keyboard flip/grade, and `<200ms` hardware springs. |
| **Zeigarnik Effect** | Folded page dogears and automatic *"Resume reading"* bookmarks preserve unfinished study context without nagging banners. |
| **Goal-Gradient & Peak-End** | Visually thinning flashcard stack culminating in a calm Kit completion card when due cards reach zero. |

---

## 8. Shared UI Component Library (`src/components/ui/`)

Always reuse primitives from `src/components/ui` before writing custom controls:

- [`KitLogo.tsx`](src/components/ui/KitLogo.tsx): `KitLogo`, `KitAvatar`
- [`DomainGlyph.tsx`](src/components/ui/DomainGlyph.tsx): `DomainGlyph`, `resolveKitGlyph`
- [`Controls.tsx`](src/components/ui/Controls.tsx): `Button`, `Kbd`, `HelpHint`, `SegmentedControl`, `SelectPopover`, `FluidAccordion`, `StageTransition`, `ToastStack`
- [`NotebookPrimitives.tsx`](src/components/ui/NotebookPrimitives.tsx): `DogearCorner`, `NotebookSheet`, `HighlightableProse`, `NoteUpdateCard`, `InvitingComposer`, `VoiceWaveform`
- [`StudyPrimitives.tsx`](src/components/ui/StudyPrimitives.tsx): `ScrubberSlider`, `RetrievabilityRing`, `ForgettingCurve`, `AnkiGradeBar`, `AnkiCardStack`
- [`Primitives.tsx`](src/components/ui/Primitives.tsx) / [`index.ts`](src/components/ui/index.ts): Barrel re-exports
- [`DesignSystemPage.tsx`](src/pages/DesignSystemPage.tsx): Interactive `/design-system` showcase

---

## 9. Constructive Diagrams, Math & Responsive Rules

- **Sanitized Inline SVG (`language-svg`)**: Sanitized by `src/utils/sanitizeSvg.ts` and rendered by `SvgFigureRenderer.tsx` using `currentColor` and theme surface tokens.
- **Mermaid (`language-mermaid`)**: Rendered via `MermaidRenderer.tsx` (`securityLevel: 'strict'`), synced to `appStore.theme`.
- **KaTeX Math**: Bundled locally (`katex/dist/katex.min.css`) for offline zero-latency equation rendering.
- **Responsive (`< 768px`) & Motion**: Desktop collapsible `Sidebar` switches to `MobileHeader` + `MobileDrawer` with zero horizontal overflow; all animations honor `@media (prefers-reduced-motion: reduce)`.
