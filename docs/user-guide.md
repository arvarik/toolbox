# Toolbox v2 — User Guide

Practical guide to Toolbox v2's workflows, multi-Kit Library, Deep Research Kit Compiler, FSRS-6 spaced repetition, Guided Drills, Dual-Mode Canvas, and MCP integration.

---

## 1. Library Home & Portable Kits (`/`, `/shared`)

Toolbox organizes every subject into a self-contained **Kit** — a curriculum prerequisite graph (`KitSkeleton`), Guide blueprint sections, Flashcard decks, Guided Drills, Canvas boards, AI Tutor persona prompts, and uploaded reference sources.

- **System Design Starter Kit**: On a new instance the Library is empty. Click **Add System Design Kit** to add the official starter Kit in one click. Kit pages such as `/chat` also create it on first use.
- **Personal Library (`/`)**: Switch between Kits, resume where you left off, or click **Import** to load either:
  - `<slug>.toolbox-kit.json` (**Mode 1**): A clean curriculum skeleton shared by another learner or instructor.
  - `<slug>.toolbox-backup.zip` (**Mode 2**): A complete backup restoring your flashcards, FSRS-6 scheduling state, Guide notes, boards, chat history, and uploaded PDFs.
- **Shared Library (`/shared`)**: On multi-user instances, publish Kits to your instance's Shared Library (`Publish`) or fork Kits published by teammates (`Fork`) and pull non-destructive upstream curriculum updates (`Sync`) — any notes tied to removed topics are preserved in **Archived Notes** so nothing is lost.

---

## 2. New Kit Studio & Living Kits (`/new`)

Click **Create Kit** (`/new`) to compile a structured Kit on any technical or academic subject in 3 steps:

1. **Sources & Topic**: Enter your topic and learning goal. Optionally upload PDFs (parsed locally via `unpdf`), Markdown/text files, or paste reference URLs.
2. **Calibrate Scope**: Answer 3 quick scoping questions that calibrate depth, prior knowledge, and workspace capabilities (`Architecture` whiteboard, Novakian `Concept` map, or `None`; BotE Calculator on/off).
3. **Blueprint & DAG**: Toolbox runs grounded web research (when SearXNG is configured) and compiles an acyclic prerequisite DAG of pillars, topics, blueprint sections, and learning tracks. Request natural-language adjustments (*"Add a pillar on consensus protocols"*, *"Split Raft and Paxos"*) and commit the Kit to your Library.

### Living Kit Expansion
On a Kit card in the Library (`/`), click **Expand Kit** to research and splice new sub-DAG nodes (usually 4–12) into your curriculum without disturbing existing notes or flashcard progress.

---

## 3. Kit Mastery Path & Knowledge Graph (`/k/:slug`, `/k/:slug/graph`)

- **Mastery Path (`/k/:slug`)**: Displays pillars, node status (`Mastered`, `Needs Remediation`, `In Progress`, `Ready / Unlocked`, `Locked`), due flashcard counts, and quick actions into Guide, Drills, Chat, or `⚡ Challenge Node`.
- **Knowledge Graph (`/k/:slug/graph`)**: Interactive React Flow + `dagre` prerequisite DAG colored by live FSRS-6 retrievability $R(t, S)$. Hover or select any node to highlight upstream prerequisites and downstream dependents, filter by readiness or learning track, and launch targeted study sessions.

---

## 4. Guided Drills & `⚡ Challenge Node` (`/k/:slug/drills`)

Guided Drills test active generation rather than passive recognition:

- **3 Difficulty Levels**: Generate a drill for any node at Level 1, 2, or 3, and filter the drill list by level.
- **Attempt-Gated Workflow**: Worked solutions stay locked until you submit an earnest attempt. Up to **3 progressive hints** are available:
  - *Hint 1* (conceptual nudge): no score penalty.
  - *Hint 2* (structural scaffold): caps score at `80%`.
  - *Hint 3* or *Reveal Solution*: marks the attempt **assisted** (no mastery/FIRe credit).
- **Anti-Sycophancy Grading**: Submissions are graded errors-first against an explicit rubric. Any factual or logical error automatically caps the score below passing (`≤ 59%`) and triggers Socratic follow-up plus prerequisite remediation if needed.
- **`⚡ Challenge Node`**: Already know a topic? Click **Challenge Node** on any node to tackle a difficulty-3 scenario plus a first-principles Feynman explanation. Scoring `≥ 85%` unassisted with zero errors commits your explanation into your Guide notes, graduates the node's flashcards (`21-day` stability), and awards upward FIRe credit to prerequisite nodes.

---

## 5. Spaced Repetition Flashcards (`/k/:slug/study`, `/review`)

- **FSRS-6 Scheduling**: Rate each card **Again**, **Hard**, **Good**, or **Easy** (`1`–`4` or keyboard shortcuts). Each deck targets 90% recall by default. Deck Options set daily limits and learning steps.
- **Confidence Calibration**: Before revealing a card, pick **Low**, **Medium**, or **High** confidence. **Low** caps a Good or Easy rating at Hard, so lucky guesses do not inflate intervals. **High** halves the first relearning step after a miss (hypercorrection). **Medium** does not change the schedule.
- **FIRe Graph Credit & Adaptive Remediation**:
  - Rating a Review card Good or Easy, or scoring 80% or more on an unassisted drill, propagates fractional stability credit 1–2 hops **up** your prerequisite graph, reducing redundant basic reviews.
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
- **Personal `tbk_` Tokens & MCP**: Mint read-write or **read-only** `tbk_` tokens under **Model Context Protocol (MCP) Server** to connect Claude Desktop, Cursor, or Claude Code to `POST /api/mcp` — letting external AI assistants search your Kits, inspect due cards, record reviews, or commit study notes.

---

## 9. Keyboard Shortcuts

Use `⌘` on macOS or `Ctrl` on Windows/Linux (`src/hooks/useKeyboardShortcuts.ts`):

| Shortcut | Action |
|----------|--------|
| `⌘K` or `⌘/` | Open Global Hybrid Search / Command Palette |
| `⌘1` | AI Chat (`/chat` or `/k/:slug/chat`) |
| `⌘2` | Knowledge Guide (`/guide` or `/k/:slug/guide`) |
| `⌘3` | Canvas (`/k/:slug/builder` for architecture Kits, `/k/:slug/canvas` for concept Kits) |
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
| `⌘?` (`⌘⇧/`) | Open the keyboard shortcuts cheat sheet |
