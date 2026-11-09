# Toolbox v2 — User Guide

Practical guide to Toolbox v2's workflows, multi-Kit Library, Deep Research Kit Compiler, FSRS-6 spaced repetition, Guided Drills, Dual-Mode Canvas, and MCP integration.

---

## 1. Library Home & Portable Kits (`/`, `/shared`)

Toolbox organizes every subject into a self-contained **Kit** — a curriculum prerequisite graph (`KitSkeleton`), Guide blueprint sections, Flashcard decks, Guided Drills, Canvas boards, AI Tutor persona prompts, and uploaded reference sources.

- **System Design Starter Kit**: Provisioned automatically on first launch so you can start studying immediately.
- **Personal Library (`/`)**: Switch between Kits, resume where you left off, or click **Import** to load either:
  - `<slug>.toolbox-kit.json` (**Mode 1**): A clean curriculum skeleton shared by another learner or instructor.
  - `<slug>.toolbox-backup.zip` (**Mode 2**): A complete backup restoring your flashcards, FSRS-6 scheduling state, Guide notes, boards, chat history, and uploaded PDFs.
- **Shared Library (`/shared`)**: On multi-user instances, publish Kits to your instance's Shared Library (`Publish`) or fork Kits published by teammates (`Fork`) and pull non-destructive upstream curriculum updates (`Sync`) — any notes tied to removed topics are preserved in **Archived Notes** so nothing is lost.

---

## 2. New Kit Studio & Living Kits (`/new`)

Click **+ New Kit** (`/new`) to compile a structured Kit on any technical or academic subject through 4 stages:

1. **Ingest Sources (Optional)**: Upload PDFs (parsed locally via `unpdf`), Markdown/text files, or paste reference URLs.
2. **Calibrate**: Enter your topic and learning goal. Toolbox generates 3–5 quick diagnostic questions to calibrate depth, prior knowledge, and workspace capabilities (`Architecture` whiteboard, Novakian `Concept` map, or `None`; BotE Calculator on/off).
3. **Synthesize**: Streams grounded web research (when SearXNG is configured) and compiles an acyclic prerequisite DAG of pillars, topics, blueprint sections, and learning tracks.
4. **Refine & Commit**: Request natural-language adjustments (*"Add a pillar on consensus protocols"*, *"Split Raft and Paxos"*) and commit the Kit to your Library.

### Living Kit Expansion
Inside any existing Kit's Mastery Path (`/k/:slug`) or Knowledge Graph (`/k/:slug/graph`), trigger **Expand Kit** to research and splice 1–6 new sub-DAG nodes into your curriculum without disturbing existing notes or flashcard progress.

---

## 3. Kit Mastery Path & Knowledge Graph (`/k/:slug`, `/k/:slug/graph`)

- **Mastery Path (`/k/:slug`)**: Displays pillars, node readiness (`Ready`, `Due`, `Weak`, `Mastered`, `Blocked`), due flashcard counts, and quick actions into Guide, Drills, Chat, or `⚡ Challenge Node`.
- **Knowledge Graph (`/k/:slug/graph`)**: Interactive React Flow + `dagre` prerequisite DAG colored by live FSRS-6 retrievability $R(t, S)$. Hover or select any node to highlight upstream prerequisites and downstream dependents, filter by readiness or learning track, and launch targeted study sessions.

---

## 4. Guided Drills & `⚡ Challenge Node` (`/k/:slug/drills`)

Guided Drills test active generation rather than passive recognition:

- **4 Drill Modes**: `Recall`, `Apply` (scenario problem-solving), `Synthesize` (connecting multiple nodes), and `Critique` (finding flaws in a proposed design or argument).
- **Attempt-Gated Workflow**: Worked solutions stay locked until you submit an earnest attempt. Up to **3 progressive hints** are available:
  - *Hint 1* (conceptual nudge): no score penalty.
  - *Hint 2* (structural scaffold): caps score at `80%`.
  - *Hint 3* or *Reveal Solution*: marks the attempt **assisted** (no mastery/FIRe credit).
- **Anti-Sycophancy Grading**: Submissions are graded errors-first against an explicit rubric. Any factual or logical error automatically caps the score below passing (`≤ 59%`) and triggers Socratic follow-up plus prerequisite remediation if needed.
- **`⚡ Challenge Node`**: Already know a topic? Click **Challenge Node** on any node to tackle a difficulty-3 scenario plus a first-principles Feynman explanation. Scoring `≥ 85%` unassisted with zero errors commits your explanation into your Guide notes, graduates the node's flashcards (`21-day` stability), and awards upward FIRe credit to prerequisite nodes.

---

## 5. Spaced Repetition Flashcards (`/k/:slug/study`, `/review`)

- **FSRS-6 Scheduling**: Rate each card **Again**, **Hard**, **Good**, or **Easy** (`1`–`4` or keyboard shortcuts). Adjust per-deck **Desired Retention** (`75%`–`97%`, default `90%`) in Deck Settings to trade review workload against recall probability.
- **Confidence Calibration**: Tag reviews as *Guessed* (caps passing grades to Hard so lucky guesses don't inflate intervals) or *High Confidence* (halves relearning delay on a miss via Hypercorrection).
- **FIRe Graph Credit & Adaptive Remediation**:
  - Passing advanced cards or unassisted drills propagates fractional stability credit 1–2 hops **up** your prerequisite graph, reducing redundant basic reviews.
  - Failing a card or drill automatically queues up to 3 shaky prerequisite cards into the front of your review queue (`Remediation`).
- **Global Review (`/review`) & Kit Interleaved (`/k/:slug/interleaved`)**: Study all due cards across your active Kit or across every Kit in your Library in one shuffled session.

---

## 6. AI Tutor Chat & Knowledge Guide (`/k/:slug/chat`, `/k/:slug/guide`)

- **AI Tutor Chat**: Session-based tutor with 4 coaching personas (*Socratic*, *ELI5*, *Strict*, *Devil's Advocate*), grounded via local **Hybrid Search** (`FTS5` + `sqlite-vec` across your notes, cards, and uploaded PDFs) and optional **SearXNG Web Research** with inline source citations.
- **Constructive Diagrams & Math**: Responses and Guide notes render sanitized inline `language-svg` figures, strict-mode `mermaid` diagrams, and offline `KaTeX` math (`$...$` and `$$...$$`).
- **Commit to Guide**: Extract structured takeaways from any chat conversation directly into your Kit's Guide blueprint sections, or edit Markdown notes manually in `/k/:slug/guide`.

---

## 7. Dual-Mode Canvas, Feynman & BotE Calculator

- **Dual-Mode Canvas (`/k/:slug/builder` or `/k/:slug/canvas`)**:
  - **Architecture Mode**: Drag-and-drop system components (load balancers, caches, queues, databases), load starter templates, and run **AI Critique** for bottlenecks, SPOFs, and trade-offs.
  - **Concept Map Mode**: Build Novakian concept maps with labeled **edge linking phrases** (`[Concept A] —causes→ [Concept B]`) and run **AI Critique** to verify proposition accuracy and missing cross-links.
- **Feynman Evaluator (`/k/:slug/feynman`)**: Explain a topic in plain language (typing or browser speech-to-text) to receive structured gap, jargon, and error analysis.
- **BotE Calculator (`/k/:slug/calculator` or `⌘E`)**: Live QPS, storage, bandwidth, cache, and latency estimation sandbox with 1-click Markdown export and **Audit My Math** AI verification (shown on Kits where `calculator` capability is enabled).

---

## 8. Settings, BYOK & External MCP Clients (`/settings`)

- **AI Capability Router & BYOK**: Choose models per task tier — **Quick** (fast starters/classification), **Deep** (tutoring, grading, critique), and **Research** (Kit synthesis & expansion). Supply personal encrypted **BYOK** keys (`Gemini`, `OpenAI`, `Claude`) or custom OpenAI-compatible endpoints (`Ollama`, `vLLM`, `LM Studio`, `OpenRouter`).
- **Account & Security**: Manage password, active sessions, **Passkeys**, and linked **OIDC** accounts.
- **Personal `tbk_` Tokens & MCP**: Mint read-write or **read-only** `tbk_` tokens under **API & MCP Tokens** to connect Claude Desktop, Cursor, or Claude Code to `POST /api/mcp` — letting external AI assistants search your Kits, inspect due cards, record reviews, or commit study notes.

---

## 9. Keyboard Shortcuts

Use `⌘` on macOS or `Ctrl` on Windows/Linux (`src/hooks/useKeyboardShortcuts.js`):

| Shortcut | Action |
|----------|--------|
| `⌘K` or `⌘/` | Open Global Hybrid Search / Command Palette |
| `⌘1` | AI Chat (`/chat` or `/k/:slug/chat`) |
| `⌘2` | Knowledge Guide (`/guide` or `/k/:slug/guide`) |
| `⌘3` | Canvas (`/builder` or `/k/:slug/canvas`, if enabled on Kit) |
| `⌘4` | Flashcards (`/study` or `/k/:slug/study`) |
| `⌘5` | Feynman Evaluator (`/feynman` or `/k/:slug/feynman`) |
| `⌘6` | Interleaved Review (`/interleaved` or `/k/:slug/interleaved`) |
| `⌘7` | Knowledge Graph (`/graph` or `/k/:slug/graph`) |
| `⌘8` | BotE Calculator page (if enabled on Kit) |
| `⌘9` | Toggle Pomodoro Focus Timer |
| `⌘E` | Toggle quick BotE Calculator modal (outside text inputs) |
| `⌘J` | Toggle sliding AI Chat panel (on Guide, Canvas, and Study pages) |
| `⌘B` | Collapse / expand navigation sidebar (outside text inputs) |
| `⌘D` | Toggle Dark / Light theme (outside text inputs) |
| `⌘S` | Save active Canvas board |
| `⌘,` | Open Settings (`/settings`) |
