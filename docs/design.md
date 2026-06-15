# Toolbox — Design Reference

This document describes the visual design language, component patterns, and UX principles of the Toolbox app. Use this when adding new UI features or modifying existing ones.

---

## Design Philosophy

The UI is designed to feel like a **focused developer tool** — dark, information-dense, and calm. Influences include Linear, GitHub, and Raycast: clean, fast, and opinionated.

**Core principles:**
1. **Dark by default** — dim lighting for long study sessions
2. **Information density** — show what matters, hide what doesn't
3. **Micro-interactions** — small animations signal state, not just decoration
4. **Monochrome with one accent** — everything is gray/white with a single indigo accent pop
5. **Keyboard-first** — every major action has a shortcut

---

## Color Palette

Defined in `src/index.css` as CSS Custom Properties. **Always use variables, never hardcoded hex values.**

### Dark Theme

```css
--color-bg-primary:    #0a0a0f   /* Deepest background */
--color-bg-secondary:  #111118   /* Page background */
--color-bg-tertiary:   #1a1a24   /* Elevated backgrounds (sidebar, panels) */
--color-surface:       #1e1e2a   /* Cards, inputs */
--color-surface-hover: #252535   /* Hover state for interactive surfaces */
--color-border:        #2a2a3a   /* Borders */
--color-border-subtle: #222230   /* Very subtle borders */

--color-text-primary:   #f0f0ff  /* Headings, primary content */
--color-text-secondary: #9898b0  /* Body text, descriptions */
--color-text-tertiary:  #666680  /* Timestamps, metadata */
--color-text-muted:     #444460  /* Disabled, placeholder */

--color-accent:         #818cf8  /* Indigo — primary CTA, active states */
--color-accent-hover:   #939af8  /* Lighter on hover */
--color-accent-subtle:  #2d3070  /* Accent tint for backgrounds */
--color-accent-glow:    rgba(99, 102, 241, 0.15) /* Soft glow effect */

--color-success:        #34d399  /* Green — save, done, correct */
--color-error:          #f87171  /* Red — error, delete, wrong */
--color-warning:        #fbbf24  /* Yellow — caution states */
--color-teal:           #2dd4bf  /* Teal — secondary accent (streaks, stats) */
```

### Light Theme

Light theme overrides the same custom properties with lighter values. The entire theme is controlled via `data-theme="light"` on `<html>`.

---

## Typography

**Font**: [Inter](https://fonts.google.com/specimen/Inter) (loaded from Google Fonts in `index.html`), falling back to system-ui.

```css
--font-sans: 'Inter', system-ui, -apple-system, sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', Consolas, monospace;

--text-xs:   0.75rem / 1rem   /* 12px — metadata, badges */
--text-sm:   0.875rem / 1.25rem /* 14px — secondary UI */
--text-base: 1rem / 1.5rem    /* 16px — body, inputs */
--text-lg:   1.125rem / 1.75rem /* 18px — section headers */
--text-xl:   1.25rem / 1.75rem /* 20px — card titles */
--text-2xl:  1.5rem / 2rem    /* 24px — page titles */
--text-3xl:  1.875rem / 2.25rem /* 30px — hero headings */
```

---

## Spacing Scale

Uses a 4px base unit. Always use variables — never raw pixel values:

```css
--space-1:  4px
--space-2:  8px
--space-3:  12px
--space-4:  16px
--space-5:  20px
--space-6:  24px
--space-8:  32px
--space-10: 40px
--space-12: 48px
--space-16: 64px
```

---

## Border Radius

```css
--radius-sm:   4px   /* Input, tag, badge */
--radius-md:   8px   /* Card, button */
--radius-lg:   12px  /* Modal, large card */
--radius-xl:   16px  /* Sidebar, overlay panel */
--radius-full: 9999px /* Pill, circle avatar */
```

---

## Elevation / Shadow

```css
--shadow-sm:  0 1px 3px rgba(0,0,0,0.4)
--shadow-md:  0 4px 12px rgba(0,0,0,0.5)
--shadow-lg:  0 8px 32px rgba(0,0,0,0.6)
--shadow-glow: 0 0 20px var(--color-accent-glow)
```

---

## Component Patterns

### Buttons

```jsx
// Primary action (filled accent)
<button className="btn btn-primary">Save Changes</button>

// Secondary (outlined)
<button className="btn btn-secondary">Cancel</button>

// Ghost (text only)
<button className="btn btn-ghost">Learn more</button>

// Icon-only
<button className="btn btn-icon"><Plus size={16} /></button>

// Sizes
<button className="btn btn-primary btn-sm">Small</button>
<button className="btn btn-primary btn-lg">Large</button>
```

Button anatomy: `padding: var(--space-2) var(--space-4)`, `font-size: var(--text-sm)`, `border-radius: var(--radius-md)`, `transition: all 150ms ease`.

### Cards

```jsx
<div className="card">
  {/* Static card */}
</div>

<div className="card card-interactive" onClick={...}>
  {/* Clickable card with hover lift */}
</div>
```

Card base: `background: var(--color-surface)`, `border: 1px solid var(--color-border)`, `border-radius: var(--radius-lg)`, `padding: var(--space-5)`.

### Inputs

```jsx
<input className="input" type="text" placeholder="Search..." />
<textarea className="input" rows={4} />
```

Input base: `background: var(--color-bg-primary)`, `border: 1px solid var(--color-border)`, `border-radius: var(--radius-md)`, focused: `border-color: var(--color-accent)`.

### Badges / Tags

```jsx
<span className="tag">Storage</span>
<span className="badge badge-success">Active</span>
<span className="badge badge-error">3 Due</span>
```

---

## Layout System

### Page Wrapper

Every page should wrap its content:

```jsx
<div className="page-wrapper">
  <div className="page-header">
    <h1 className="page-title">Page Title</h1>
    <p className="page-subtitle">A brief description.</p>
  </div>
  {/* Content */}
</div>
```

### Sidebar

The sidebar is `240px` wide, collapsible to `0` (hidden). It has three zones:
1. **Logo area** — app name and icon
2. **Navigation** — grouped nav items with keyboard shortcut badges
3. **Footer** — model selector, Pomodoro widget, Settings

### Two-Column (Study Plan + Content)

The Chat page uses a `280px` left sidebar (Study Plan) and a flexible main content area. Pattern:

```css
.chat-layout {
  display: grid;
  grid-template-columns: 280px 1fr;
}
```

### Three-Column (Toolbox + Canvas + Optional Panel)

The Builder page:

```css
.builder-layout {
  display: grid;
  grid-template-columns: 240px 1fr [optional: 360px];
}
```

---

## Motion & Animation

### Transition Classes

```css
/* Use on interactive elements */
transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease;

/* For visibility/opacity toggles */
transition: opacity 200ms ease, transform 200ms ease;

/* For sliding panels */
transition: transform 300ms cubic-bezier(0.25, 0.8, 0.25, 1);
```

### Key Animations (defined in index.css)

| Animation | Usage |
|-----------|-------|
| `fadeIn` | Modal/overlay appear |
| `slideUp` | Toast notifications, card enter |
| `slideIn` | Sidebar panel, drawer |
| `pulse` | Loading indicators |
| `shimmer` | Skeleton loading states |
| `popIn` | Aha moment, success states |

### Card Flip (Flashcards)

```css
.card-flip-wrapper { perspective: 1000px; }
.card-flip-inner { transform-style: preserve-3d; transition: transform 0.4s ease; }
.card-flip-inner.flipped { transform: rotateY(180deg); }
.card-front, .card-back { backface-visibility: hidden; }
.card-back { transform: rotateY(180deg); }
```

---

## Mobile Responsiveness

Breakpoints:
- `768px` — tablet/mobile split
- `480px` — small phone

At `< 768px`:
- Sidebar hides, replaced by `BottomNav.jsx` (4 tabs) and `MobileHeader.jsx`
- `MobileDrawer.jsx` replaces the desktop sidebar for navigation
- Multi-column grids collapse to single column
- Study Plan sidebar collapses to a progress bar

Always check mobile layouts before shipping a new feature. Use the browser DevTools device emulator.

---

## Empty States

Every list/grid should have a meaningful empty state using the `<EmptyState />` component:

```jsx
<EmptyState
  icon={<Library size={32} />}
  title="No decks yet"
  description="Create your first flashcard deck to start studying."
  action={{ label: "Create Deck", onClick: handleCreate }}
/>
```

---

## Loading States

- **Skeleton loading** — for lists that fetch on mount (use `shimmer` CSS animation)
- **Spinner** — `<Loading />` component for inline action feedback
- **Streaming cursor** — animated `▋` cursor appended to AI responses during streaming

---

## Dark Mode Contrast Requirements

| Use case | Minimum contrast ratio |
|----------|----------------------|
| Body text on background | 4.5:1 (WCAG AA) |
| Large text / icons | 3:1 |
| Interactive element states | 3:1 |
| Placeholder text | 3:1 |

The current palette meets these requirements for dark mode. When adding new colors, verify with a contrast checker.

---

## Do's and Don'ts

### ✅ Do

- Use `var(--color-*)` and `var(--space-*)` everywhere
- Add hover states to all interactive elements (`cursor: pointer`, subtle background shift)
- Use `transition` on all interactive elements for smooth feel
- Pair destructive actions (delete) with confirmation dialogs
- Show success/error state via toasts, not browser alerts
- Use lucide-react icons consistently sized (`size={14}`, `size={16}`, `size={18}`, `size={20}`, `size={24}`)

### ❌ Don't

- Hardcode colors (`color: #818cf8`) — use `var(--color-accent)`
- Use `!important` — restructure specificity instead
- Use `display: none` for toggling visibility if the element needs animation — use `opacity` + `pointer-events: none` + `transform`
- Add external UI libraries (Radix, Headless UI, Chakra, etc.)
- Use raw `px` values for spacing — use `var(--space-*)`
- Ship features without mobile-testing
