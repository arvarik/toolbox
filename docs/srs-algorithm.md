# Toolbox v2 — Spaced Repetition, Graph Credit & Pedagogy Specification

Complete mathematical and algorithmic specification for Toolbox v2's scheduler (`server/srs/scheduler.ts`), prerequisite graph credit (`server/graph/encompassing.ts`), downward remediation (`server/graph/remediation.ts`), graph health (`server/graph/health.ts`), and anti-sycophancy drill grading (`server/srs/antiSycophancy.ts`).

---

## 1. Pure-TypeScript FSRS-6 Scheduler (`server/srs/scheduler.ts`)

Toolbox v2 replaces v1's SM-2 formula with a pure-TypeScript implementation of **FSRS-6** (Difficulty–Stability–Retrievability, 21 weights) while preserving full backward compatibility with v1 card rows and quality ratings.

### Card States & Rating Scale

| `state` | Name | Scheduling Behavior |
|---------|------|---------------------|
| `0` | **New** | Never reviewed; initializes $(S_0, D_0)$ on first review |
| `1` | **Learning** | Intraday minute-based steps (deck setting `steps`, default `1m 10m`) before graduating to Review |
| `2` | **Review** | Day-based intervals computed from Stability $S$ and `desired_retention` $R_d$ |
| `3` | **Relearning** | Lapsed Review card stepping through `lapse_steps` (default `10m`) |

The REST review endpoint accepts SM-2 `quality` (`0..5`). The MCP `review_card` tool also accepts an FSRS `rating` (`1..4`). `qualityToFsrsGrade` maps quality to a grade:
- **Again (`1`)**: `quality <= 2`
- **Hard (`2`)**: `quality === 3`
- **Good (`3`)**: `quality === 4`
- **Easy (`4`)**: `quality >= 5`

### Default 21-Weight Vector (`FSRS6_DEFAULT_WEIGHTS`)

```ts
w = [
  0.212,  1.2931, 2.3065, 8.2956, // w[0..3]  initial stability S0(G) for Again..Easy
  6.4133, 0.8334, 3.0194, 0.001,  // w[4..7]  initial difficulty, damping & mean reversion
  1.8722, 0.1666, 0.796,          // w[8..10] recall stability growth exponents
  1.4835, 0.0614, 0.2629, 1.6483, // w[11..14] forget (lapse) post-stability parameters
  0.6014, 1.8729,                 // w[15..16] Hard penalty & Easy bonus multipliers
  0.5425, 0.0912, 0.0658,         // w[17..19] short-term (same-day / learning) stability
  0.1542,                         // w[20]    power-law forgetting curve decay
]
```

### Retrievability & Optimal Next Interval

Given elapsed time $t \ge 0$ (in days) since `last_reviewed` and Stability $S > 0$ (days until recall probability drops to 90%):

$$\text{factor} = 0.9^{-1/w_{20}} - 1, \qquad R(t, S) = \left(1 + \text{factor} \cdot \frac{t}{S}\right)^{-w_{20}}$$

For a deck's target `desired_retention` $R_d \in [0.75, 0.97]$ (default $0.90$, set through the deck settings API), the next Review interval in days (at least 1, then scaled by the deck's `interval_modifier`, default `1.0`) is:

$$I(S, R_d) = \max\left(1,\; \text{round}\left(\frac{S}{\text{factor}} \left(R_d^{-1/w_{20}} - 1\right)\right)\right)$$

### DSR State Transitions

1. **Initial State (`New` card, grade $G \in \{1,2,3,4\}$)**:
   $$S_0(G) = \max(0.01, w_{G-1}), \qquad D_0(G) = \text{clamp}_{[1,10]}\!\left(w_4 - e^{w_5 (G - 1)} + 1\right)$$

2. **Difficulty Update (linear damping + mean reversion toward $D_0(4)$)**:
   $$\Delta D = -w_6 (G - 3), \qquad D' = D + \Delta D \cdot \frac{10 - D}{9}$$
   $$D_{\text{next}} = \text{clamp}_{[1,10]}\!\left(w_7 D_0(4) + (1 - w_7) D'\right)$$

3. **Short-Term / Intraday Stability ($t < 1$ day or Learning steps)**:
   $$S_{\text{short}}(S, G) = S \cdot e^{w_{17}(G - 3 + w_{18})} \cdot S^{-w_{19}}$$
   *(For $G \ge 3$, $S_{\text{short}}$ is floored at $S$ so a passing intraday review never shrinks stability.)*

4. **Long-Term Recall Stability (`Review` card, $G \in \{2,3,4\}$)**:
   $$S_{\text{recall}}(D, S, R, G) = S \cdot \left(1 + e^{w_8} (11 - D) S^{-w_9} \left(e^{w_{10}(1 - R)} - 1\right) \cdot m_{\text{hard}} \cdot m_{\text{easy}}\right)$$
   where $m_{\text{hard}} = w_{15}$ if $G = 2$ (else $1$) and $m_{\text{easy}} = w_{16}$ if $G = 4$ (else $1$).

5. **Post-Lapse Stability (`Review` card, $G = 1$, increments `lapses`)**:
   $$S_{\text{forget}}(D, S, R) = \min\!\left(S,\; w_{11} D^{-w_{12}} \left((S + 1)^{w_{13}} - 1\right) e^{w_{14}(1 - R)}\right)$$

### Lazy v1 SM-2 Migration (`bootstrapSm2Card`)

Legacy v1 cards (`stability == null` or `difficulty == null`) are migrated lazily on first read or review without destructive data resets:
- $S = \max(0.5, \text{interval} \parallel 1)$
- $D = \text{clamp}_{[1,10]}(11 - 2.5 \cdot \text{ease\_factor})$
- Legacy `ease_factor` is kept mirrored via $\text{ease} = \text{clamp}_{[1.3, 3.5]}\!\left(\frac{11 - D}{2.5}\right)$ so existing UI filters and analytics remain consistent.

### Metacognitive Confidence & Hypercorrection

- **Guessed Pass Cap**: Submitting `confidence: "guessed"` on a passing rating (`quality > 3`, i.e., Good or Easy) caps the effective grade to **Hard (`G = 2`)** so lucky guesses do not inflate stability. Only API clients send `guessed` today. The web app's **Low** option and the MCP tool send `low`, which the scheduler treats like `medium`.
- **High-Confidence Lapse (Hypercorrection)**: Failing (`G = 1`) while declaring `confidence: "high"` halves the initial learning/relearning step (`Math.max(1, steps[0] / 2)` minutes) to force immediate error correction.

---

## 2. Knowledge Graph Health (`server/graph/health.ts`)

Each Kit's curriculum forms a validated DAG (`KitSkeleton`). Node health comes from the cards mapped to that `node_id`:
- Review cards contribute their live FSRS-6 retrievability $R(t, S)$ as strength. Other cards use fixed scores, from `0` for new cards to `1` for mastered cards.
- Each node gets a health bucket (`mastered`, `due`, `decayed`, or `unseen`) and the flags `locked` and `ready`. A node is `locked` while a direct prerequisite is unsatisfied, and `ready` when it is `unseen` and not locked.
- A prerequisite counts as satisfied when at least 60% of its cards have graduated (`PREREQ_SATISFIED_RATIO = 0.6`).

---

## 3. FIRe-Lite Upward Prerequisite Credit (`server/graph/encompassing.ts`)

Inspired by **Fractional Implicit Repetition (FIRe)**, demonstrating recall on an advanced node implicitly exercises its prerequisites. When a learner rates a Review flashcard Good or Easy (`quality >= 4`) or passes an **unassisted** drill (`masteryEligible && score >= 0.8`), Toolbox propagates fractional stability credit up the Kit's prerequisite DAG:

- **Hop Decay**: Direct prerequisites (1 hop) receive $\alpha_1 = 0.50$; 2-hop ancestors receive $\alpha_2 = 0.25$.
- **Eligible Targets**: Only graduated cards (`state = 2`) on ancestor nodes that are **not** currently queued in `remediation_queue`.
- **Spacing Discount**: Credit scales by how much forgetting has actually occurred so rapid back-to-back drills cannot spam stability:
  $$\Delta = \alpha_{\text{hop}} \cdot \text{weight} \cdot (1 - R(t, S))$$
  Cards with $\Delta < 0.05$ (`MIN_IMPLICIT_DELTA`) are skipped.
- **Stability Interpolation**:
  $$S_{\text{new}} = S + \Delta \cdot \left(S_{\text{recall}}(D, S, R, 3) - S\right)$$
  `next_review` is only pushed forward (never pulled earlier than its existing timestamp).

---

## 4. Downward Prerequisite Remediation (`server/graph/remediation.ts`)

When a learner fails a flashcard (`quality < 3`), `planRemediation` inspects cards belonging to direct prerequisite nodes (or explicit `card.prerequisite_id`). When a learner fails a drill (`score < 0.60`), `planNodeFailureRemediation` does the same for the drill's node, and falls back to shaky cards on that node when no prerequisite card qualifies. Both select up to **3 shaky foundation cards** (`MAX_REMEDIATION_CARDS = 3`) matching any weakness signal:
- Not yet graduated (`state !== 2`),
- Low ease / high difficulty (`ease_factor < 2.3`),
- Short stability/interval (`interval < 4` days), or
- Currently overdue (`next_review <= now`).

Queued cards are inserted into `remediation_queue` (`ownerId`, `kit_id`, `card_id`, `source_card_id`, `node_id`, `node_name`, `reason`) and surfaced at the front of the learner's due review queue. The entry resolves on the card's next review, whatever the grade.

---

## 5. Attempt-Gated Drills & Anti-Sycophancy (`server/srs/antiSycophancy.ts`)

### Progressive Hints & Attempt Gate
Drills (difficulty `1`–`3`) require a substantive learner submission before feedback unlocks. The web app also keeps the worked solution hidden until then:
- **Hint 1** (conceptual nudge): no score cap.
- **Hint 2** (structural scaffold): caps `score <= 0.80`.
- **Hint 3** (near-complete walkthrough) or **Reveal Worked Solution**: marks the attempt `assisted = true` and `masteryEligible = false` (suppresses upward FIRe credit).

### Errors-First Grading Guardrails
To prevent LLM praise inflation:
1. Learner text is isolated inside `<untrusted_submission>...</untrusted_submission>` tags with explicit system instructions to ignore embedded grading directives.
2. The structured Zod output schema (`EvaluationResultLlmSchema`) forces the model to enumerate `extractedClaims`, `factualOrLogicalErrors`, `unexplainedJargon`, and per-item `rubricChecks` **before** emitting `score` and `pass`.
3. `enforceAntiSycophancy` applies deterministic server-side overrides:
   - Any non-empty `factualOrLogicalErrors` **hard-caps `score <= 0.59` and forces `pass = false`**, regardless of what raw score the LLM proposed.
   - `pass` is recomputed as `raw.pass && factualOrLogicalErrors.length === 0 && score >= passThreshold` (default `passThreshold = 0.75`), and `masteryEligible = pass && !assisted`.

---

## 6. `⚡ Challenge Node` Diagnostic Fast-Track (`server/routes/drills.ts`)

Experienced learners can skip basic repetition on a topic they already know via `GET /api/drills/challenge/:nodeId` and `POST /api/drills/challenge/:nodeId`:
1. Generates (or reuses) a **difficulty-3** scenario drill paired with a mandatory **first-principles Feynman explanation** prompt (`feynmanPrompt`).
2. Evaluates the combined response through the anti-sycophancy rubric with a strict threshold: **`passThreshold = 0.85`**, zero `factualOrLogicalErrors`, and `assisted = false`.
3. On pass:
   - Commits the learner's Feynman explanation into the node's first empty `guide_content` section (never overwriting existing notes).
   - Graduates non-review flashcards mapped to `nodeId` directly to `state = 2`, `stability = 21`, `difficulty = 4.5`, `interval = 21` days.
   - Propagates upward FIRe-Lite stability credit (`weight = 1.0`) to 1-hop and 2-hop prerequisite nodes.
