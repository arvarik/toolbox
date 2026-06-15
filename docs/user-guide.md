# Toolbox — User Guide

A complete guide to all features of the Toolbox system design interview preparation app.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Navigation Overview](#navigation-overview)
3. [AI Chat — Socratic Learning](#ai-chat--socratic-learning)
4. [Guide — Knowledge Library](#guide--knowledge-library)
5. [Builder — Architecture Whiteboard](#builder--architecture-whiteboard)
6. [Flashcards — Spaced Repetition](#flashcards--spaced-repetition)
7. [Feynman Simulator](#feynman-simulator)
8. [Interleaved Review](#interleaved-review)
9. [Pomodoro Timer](#pomodoro-timer)
10. [Settings & Configuration](#settings--configuration)
11. [Keyboard Shortcuts](#keyboard-shortcuts)

---

## Getting Started

After deployment (see [Deployment Guide](./deployment.md)), navigate to the app in your browser. The first thing you'll need to do is configure your **Gemini API key** in Settings to unlock all AI-powered features.

> **No API key?** Get one for free at [Google AI Studio](https://aistudio.google.com/apikey). The free tier is sufficient for regular use.

On first launch, you'll land on the **AI Chat** page with the full study plan sidebar on the left.

---

## Navigation Overview

The left sidebar provides access to all sections:

| Section | Shortcut | Description |
|---------|----------|-------------|
| **Chat** | `⌘1` | AI-powered Socratic learning with session history |
| **Guide** | `⌘2` | Structured 7-pillar knowledge library |
| **Builder** | `⌘3` | Drag-and-drop architecture whiteboard |
| **Flashcards** | `⌘4` | Spaced repetition study decks |
| **Feynman** | `⌘5` | Feynman Technique simulator |
| **Interleaved** | `⌘6` | Cross-deck review session |
| **Pomodoro** | `⌘7` | Focus timer with plant gamification |
| **Settings** | `⌘,` | API key, model, and data management |

The sidebar can be collapsed with `⌘B` to maximize your working area.

---

## AI Chat — Socratic Learning

The Chat page (`/chat`) is the primary study interface. It features a full-page AI conversation with a **Study Plan** sidebar.

### Study Plan Sidebar

The left panel shows your 7-pillar progress across all guide topics:
- **0–100% completion** tracking per topic (based on committed guide sections)
- **"START HERE" suggestion** — recommends the most relevant topic to study next
- Click any pillar/topic to automatically focus the chat on that topic

### Chat Interface

- **Named sessions** — create and manage multiple labeled chat sessions, persisted in localStorage
- **Session history** — each session stores up to 120 messages
- **Session picker dropdown** — rename, delete, or switch between sessions
- **AI Personas** — choose your study style from the persona picker:
  - 💡 **Socratic Tutor** — explains, questions, surfaces edge cases
  - 🧸 **Explain Like I'm 5** — uses everyday analogies, no jargon
  - 🔥 **Strict** — demanding engineering manager style, no fluff
  - 👿 **Devil's Advocate** — aggressively challenges your reasoning
- **Dynamic starter prompts** — when you select a topic, the AI generates fresh, topic-specific starter questions automatically
- **Streaming responses** — AI streams text in real-time with a stop button
- **Retry** — retry any user message to get a different response
- **Generate Concept Map** — after 4+ messages, generate a markdown concept map summarizing the conversation
- **Commit to Guide** — send AI responses directly into your Guide knowledge library (see Guide section)

### Commit Flow

After a productive chat session, click **Commit to Guide** to open the commit modal. The AI analyzes your conversation and suggests which guide sections to update. You can edit the content before saving, ensuring your personal notes are accurate and useful.

---

## Guide — Knowledge Library

The Guide (`/guide`) is your personal, editable knowledge reference organized around **7 pillars** of system design:

1. **Compute & Infrastructure** — Load balancers, API gateways, microservices, serverless
2. **Storage** — SQL/NoSQL, caching, object storage, search
3. **Protocols** — HTTP/REST, gRPC, WebSockets, messaging patterns
4. **Observability** — Logging, metrics, tracing, alerting
5. **Resiliency** — Circuit breakers, rate limiting, chaos engineering
6. **Distributed Systems** — Consensus, CAP theorem, replication, sharding
7. **Paradigms** — Event-driven, CQRS, saga patterns, hexagonal architecture

### Library Landing

The guide home page shows **overall progress** (% of sections filled) across all pillars, with per-pillar completion bars. Click any pillar to drill into its topics.

### Blueprint View

Each topic has a **Blueprint** — a structured set of sections covering:
- Core concepts and primitives
- Scale considerations
- Performance characteristics
- Trade-offs and failure modes
- Real-world examples
- Interview framing

Each blueprint section can be:
- **Filled** via the Commit flow from Chat sessions
- **Manually edited** in-place with the pencil icon
- **Cleared** to start fresh
- **Viewed** in rendered Markdown

### Topic-Level AI Chat

While viewing a topic, click **Ask AI** to open a contextual chat panel on the right. The AI is pre-primed with knowledge about the specific topic.

---

## Builder — Architecture Whiteboard

The Builder (`/builder`) is an interactive canvas for practicing architecture diagrams.

### Canvas

- **Drag and drop** components from the left toolbox onto the canvas
- **Connect** components by dragging from connection dots (appear on hover)
- **Pan** by clicking and dragging the canvas background
- **Zoom** with `⌘+`/`⌘-` or the zoom controls in the toolbar

### Component Library

The toolbox organizes components by category:
- **Compute** — Load Balancer, API Gateway, Microservice, Serverless Function, Background Worker, Message Queue, Event Bus, Stream Processor, Batch Processor, CDN/Edge Node
- **Storage** — SQL Database, NoSQL Database, Cache (Redis), Object Storage (S3/GCS), Full-Text Search (Elasticsearch)
- **Clients** — Web Client, Mobile Client
- **Observability** — Monitoring & Alerting

### Toolbar Features

| Tool | Function |
|------|----------|
| **Select** | Click and drag nodes, resize canvas |
| **Text** | Add free-form text labels |
| **Arrow** | Draw directional arrows |
| **Color** | Change component accent colors |
| **Undo / Redo** | Step through changes |
| **Zoom In / Out** | Adjust canvas zoom |
| **Templates** | Load pre-built architecture templates |
| **Export** | Download board as a PNG image |
| **Save** | Persist the board to the database (`⌘S`) |
| **Verify Design** | Open AI chat to review your architecture |

### Templates Gallery

Click **Templates** to browse pre-built architectures categorized by system type. Templates are loaded onto the canvas with a single click, giving you a starting point to modify.

### Multiple Boards

Create multiple named boards via the **+** tab at the top of the canvas. Boards are **auto-saved** every 3 seconds after changes.

### AI Verification

Click **Verify Design** to open a side panel where the AI reviews your whiteboard layout, identifies missing components, suggests improvements, and answers questions about your design.

---

## Flashcards — Spaced Repetition

The Flashcards section (`/study`) implements a full **Anki-style SM-2 Spaced Repetition System (SRS)**.

### Study Hub

The main view shows:
- **Study activity heatmap** — GitHub-style calendar showing your study sessions over the last year
- **Deck grid** — all your flashcard decks with due counts
- **Tag filter chips** — filter decks by custom tags
- **Search** — find decks by name or tags

### Deck Cards

Each deck card shows:
- Card count and progress
- **Due count badge** — number of cards due for review today
- Quick action buttons (hover to reveal): Study, Review Due, Browse Cards, Stats, Settings, Edit, Delete

### Creating Decks

Click **New Deck** to create a deck with:
- Name and description
- Tags (comma-separated for organization)
- Color (automatically assigned, rotates through 8 colors)
- Initial flashcards (front/back pairs)

Or use **AI Generate** to open the AI chat and describe a topic — the AI will generate flashcard content you can paste into a new deck.

### Study Session

The flashcard viewer shows one card at a time with a flip animation. After revealing the answer, rate your recall:
- **Again** — card failed, resets to learning steps
- **Hard** — partial recall, shorter interval
- **Good** — solid recall, standard interval increase
- **Easy** — easy recall, longer interval with easy bonus

The SRS algorithm (SM-2) automatically schedules cards for optimal long-term retention.

### Review Mode

Click the **clock icon** on a deck with due cards to enter Review Mode — only cards due today are shown. Review Mode uses the same SRS rating interface.

### Card Browser

Hover over a deck and click **Browse** (magnifying glass icon) to view all cards in a list. From here you can:
- Edit card front and back text inline
- Delete individual cards
- Add blank new cards
- View card SRS state (interval, ease factor, state)

### Deck Statistics

Click the **bar chart icon** on a deck to view:
- Cards by state (new, learning, review, mature)
- Due forecast (upcoming reviews over the next 7 days)
- Ease factor distribution
- Average interval
- Retention rate

### Deck Settings

Click the **gear icon** to configure per-deck SRS parameters:
- **New cards/day** — limit daily new card introductions
- **Review limit/day** — cap daily reviews
- **Learning steps** — intervals before cards graduate (e.g., `1m 10m`)
- **Lapse steps** — re-learning intervals after failed reviews
- **Easy bonus** — multiplier applied to "Easy" ratings

---

## Feynman Simulator

The Feynman page (`/feynman`) helps you identify gaps in your understanding using the Feynman Technique: if you can't explain something simply, you don't truly understand it.

### How It Works

1. **Enter a concept** — e.g., "DNS", "Paxos", "React Hooks"
2. **Write your explanation** — explain it as if talking to a beginner
3. **Voice Record** — click the microphone button to dictate instead of typing (uses browser Web Speech API)
4. **Analyze** — the AI evaluates your explanation and provides structured feedback

### Feedback Format

The AI provides feedback in four categories:
- **Missing Key Points** — crucial information you omitted
- **Unexplained Jargon** — complex terms you used without simplifying
- **Logical Gaps** — where your reasoning breaks down or skips steps
- **Overall Assessment** — a constructive summary of your comprehension level

> Note: The AI is instructed **not** to explain the concept for you — it only points out what you missed, forcing you to revisit the gaps yourself.

---

## Interleaved Review

The Interleaved page (`/interleaved`) collects **all due cards across all your decks** into a single shuffled review session.

This is particularly valuable for **interleaved practice** — a proven learning technique where mixing topics during review strengthens long-term retention compared to studying one topic at a time.

Access it from the sidebar (`⌘6`) or navigate to `/interleaved`.

---

## Pomodoro Timer

The Pomodoro timer is accessible globally from the sidebar. Click **Pomodoro** (`⌘7`) to open the timer modal.

### Timer Features

- **Three modes** — Pomodoro (25 min), Short Break (5 min), Long Break (15 min)
- **Circular progress ring** — smooth visual countdown
- **Plant gamification** — 🌱→🌿→🪴→🌸 plant grows as you focus; 🥀 if focus is lost
- **Task name** — label what you're working on
- **±5 minute adjustments** — add or subtract time during a session
- **Strict Mode** — kills the plant if you tab away while the timer is running
- **Custom durations** — configure all three timer lengths in Settings
- **Persistent state** — timer preferences persist across page refreshes

### Plant States

| Progress | Plant |
|----------|-------|
| Starting | 🌱 Seed |
| 25% complete | 🌿 Sprout |
| 50% complete | 🪴 Plant |
| 75%+ complete | 🌸 Flower |
| Focus lost (strict mode) | 🥀 Dead |

---

## Settings & Configuration

The Settings page (`/settings`) provides:

### Gemini API Key

- Enter and verify your Google Gemini API key
- Status indicator: Connected / Not configured
- Key is stored server-side in the SQLite database
- Can also be provided via the `GEMINI_API_KEY` environment variable at startup
- Get your key at [Google AI Studio](https://aistudio.google.com/apikey)

### AI Shadow Memory

The AI maintains a persistent **profile** about you to personalize responses (e.g., "interviewing at Google in 3 weeks," "strongest in distributed systems, weakest in storage"). 

- The AI automatically extracts facts from your chat sessions
- You can manually view and edit the profile text
- This context is injected into every AI prompt

### AI Model Selection

Choose from available Gemini models:
- **Gemini 3.5 Flash** — Fast and efficient (recommended for most use)
- **Gemini 2.5 Flash** — Previous generation, still capable
- **Gemini 2.5 Pro** — Most capable, slower responses
- **Gemini 2.0 Flash** — Legacy model

Model selection is persisted in localStorage and used across all AI features.

### Appearance

Toggle between **Dark Mode** (default) and **Light Mode** with the theme button, or use `⌘D` anywhere in the app.

### System Diagnostics

View database statistics:
- Guide sections filled
- Total flashcards
- Whiteboards saved
- Cached AI starters

**Clear AI Starter Caches** — forces the app to regenerate topic-specific starter prompts on next visit.

### Data Management

- **Export Guide (.md)** — Download all your committed guide notes as a single Markdown document
- **Export All Data** — Download the full database as JSON (decks, flashcards, boards, guide content, profile)
- **Import Data** — Restore from a previously exported JSON file

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘1` | Navigate to Chat |
| `⌘2` | Navigate to Guide |
| `⌘3` | Navigate to Builder |
| `⌘4` | Navigate to Flashcards |
| `⌘,` | Navigate to Settings |
| `⌘K` | Toggle AI Chat panel (on Guide, Builder, Flashcards pages) |
| `⌘B` | Toggle sidebar collapse |
| `⌘D` | Toggle Dark/Light Mode |
| `⌘S` | Save board (in Builder) |
| `⌘/` | Search topics (in Guide) |
