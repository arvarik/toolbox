# SRS Algorithm Reference

Toolbox uses a **modified SM-2 spaced repetition algorithm** (the same family used by Anki) implemented in [`server/routes/decks.js`](../server/routes/decks.js). This document explains the state machine, scheduling math, and the custom extensions on top of SM-2.

---

## Card States

Each card has a `state` field with four possible values:

| `state` | Name | Description |
|---------|------|-------------|
| `0` | **New** | Never studied. No SRS data yet |
| `1` | **Learning** | In active learning steps (sub-day intervals) |
| `2` | **Review** | Graduated — scheduled in days/months |
| `3` | **Relearning** | Lapsed from Review and is being relearned |

---

## Quality Ratings

Reviews use a 0–5 quality scale:

| Value | Label | Interpretation |
|-------|-------|----------------|
| 0–1 | Again | Failure / blank recall |
| 2–3 | Hard | Recalled with significant effort |
| 4 | Good | Correct with reasonable effort |
| 5 | Easy | Effortless recall |

> The UI maps Again=0/1, Hard=2/3, Good=4, Easy=5. Internally the algorithm checks `quality < 3` (failure), `quality === 3` (hard), `quality === 4` (good), `quality === 5` (easy).

---

## Learning Steps

Learning steps control **sub-day** intervals for new or relearning cards. Each deck can define its own steps.

**Format**: Space-separated values with `m` (minutes) or `h` (hours) suffix.

**Default**: `1m 10m` (two steps — 1 minute, then 10 minutes)

### Example step progression for a New card

```
New card
  → Again → step[0] (1m) → reset
  → Hard  → avg(step[0], step[1]) (e.g. ~5m if steps="1m 10m")
  → Good  → step[1] (10m) → if last step, graduate to Review (1 day)
  → Easy  → skip all steps, graduate immediately (4 days)
```

---

## State Transitions

### State 0: New

| Rating | Next State | Next Review |
|--------|-----------|-------------|
| Again (0–2) | Learning (1) | `lapse_steps[0]` |
| Hard (3) | Learning (1) | avg(step[0], step[1]) minutes |
| Good (4) | Learning (1) → step[1] (or Graduate if only 1 step) | `step[1]` |
| Easy (5) | **Review (2)** | 4 days |

### State 1: Learning

| Rating | Next State | Next Review |
|--------|-----------|-------------|
| Again (0–2) | Learning (1), step reset to 0 | `step[0]` |
| Hard (3) | Learning (1), same step | `current_step_val × 1.5` minutes |
| Good (4) | Advance step (or **graduate to Review** if at last step) | `next_step` or 1 day |
| Easy (5) | **Review (2)** | 4 days |

**Graduation** (Learning → Review) sets `interval = 1` day and `repetitions = 1`.

### State 2: Review

| Rating | ease_factor change | interval formula | Next Review |
|--------|-------------------|-----------------|-------------|
| Again (lapse) | −0.20 (or −0.40 for hypercorrection) | 0 → **Relearning (3)** | `lapse_steps[0]` |
| Hard (3) | −0.15 | `max(1, round(interval × 1.2))` | `interval` days |
| Good (4) | none | `max(1, round(interval × ease_factor))` | `interval` days |
| Easy (5) | +0.15 | `max(1, round(interval × ease_factor × easy_bonus))` | `interval` days |

### State 3: Relearning

Same transition logic as Learning (state 1), but using `lapse_steps` instead of `steps`. Graduating from Relearning re-enters Review state at `interval = 1`.

---

## Ease Factor

The ease factor (also called "E-Factor") is a per-card multiplier applied to intervals during Review state.

- **Initial value**: `2.5`
- **Minimum**: `1.3` (hard floor)
- **Maximum**: unbounded (grows with Easy ratings)

| Event | Δ ease_factor |
|-------|--------------|
| Again in Review (normal) | −0.20 |
| Again in Review (hypercorrection) | −0.40 |
| Hard in Review | −0.15 |
| Good in Review | 0 |
| Easy in Review | +0.15 |

---

## Hypercorrection Penalty

This is a **custom extension** not present in standard SM-2.

When a user rates a card **Again** (failure) but also reports **high confidence** (via the `confidence` field), the algorithm applies a harsher penalty:

- **ease_factor penalty**: doubled (−0.40 instead of −0.20 for Review lapses, −0.40 instead of −0.20 for New cards)
- **next review delay**: halved (`lapse_steps[0] / 2` minimum 1 minute)

**Rationale**: The Hypercorrection Effect in cognitive science shows that confidently-held wrong answers are harder to correct than uncertain ones. A harsher penalty and sooner restudy schedule accelerates correction of overconfident errors.

```
confidence values:
  "low"    → standard penalty
  "medium" → standard penalty (default)
  "high"   → hypercorrection penalty applied
```

---

## Daily Limits

Each deck enforces per-day limits to prevent overwhelming review piles:

| Setting | Default | Description |
|---------|---------|-------------|
| `new_limit` | 20 | Max new cards introduced today |
| `review_limit` | 200 | Max review cards today |

Learning/relearning cards (state 1/3) are **always shown** regardless of limits — they have short intra-day intervals that cannot be postponed without breaking the algorithm.

The limit counts are reset at **local midnight** (the server uses `date('now', 'localtime')` for SQLite date comparisons).

---

## Card Ordering Priority

When fetching due cards, the priority order within a session is:

1. **Learning / Relearning** (state 1 & 3) — highest priority, never capped
2. **Review** (state 2, due today) — capped by `review_limit`
3. **New** (state 0) — lowest priority, capped by `new_limit`

For Interleaved Review (all-deck mode), the combined list from all decks is Fisher-Yates shuffled after merging.

---

## Prerequisite Cards

Cards can have a `prerequisite_id` pointing to another card. A card with a prerequisite is **not shown** until its prerequisite card has:
- State = 2 (Review)
- `ease_factor >= 2.5` (mastered, not currently struggling)

This allows building concept dependency graphs inside a deck.

---

## SRS Preview Labels

The UI shows interval previews for all 4 buttons before the user picks. Formatting rules:

| Condition | Format |
|-----------|--------|
| State = Learning/Relearning | `Xm` or `Xh` (sub-day) |
| interval < 30 days | `Xd` |
| interval < 365 days | `Xmo` |
| interval ≥ 365 days | `Xy` |

---

## Implementation Reference

The full algorithm is a single pure function `calculateNextSrsState(card, quality, settings, confidence)` in [`server/routes/decks.js`](../server/routes/decks.js#L25). It returns a plain object with:

```js
{
  ease_factor,   // updated ease factor
  interval,      // days until next Review, or 0 if in Learning
  repetitions,   // total successful reviews
  state,         // 0-3
  learning_step, // current step index within steps[]
  next_review,   // ISO timestamp
  last_reviewed  // ISO timestamp (now)
}
```

The function is **pure** — it takes in the current card state and returns the next state without any side effects, making it straightforward to unit test independently.
