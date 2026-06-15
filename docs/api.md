# Toolbox — REST API Reference

All endpoints are mounted under `/api/`. The server listens on `PORT` (default `3100`).

All request bodies are JSON (`Content-Type: application/json`) unless noted. All responses are JSON unless noted.

---

## Table of Contents

- [Health](#health)
- [Chat & AI](#chat--ai)
- [Flashcard Decks](#flashcard-decks)
- [Flashcards](#flashcards)
- [Whiteboard Boards](#whiteboard-boards)
- [Guide Content](#guide-content)
- [User Profile (Shadow Memory)](#user-profile-shadow-memory)
- [Configuration](#configuration)
- [Search](#search)
- [Study Sessions](#study-sessions)
- [System](#system)
- [Error Responses](#error-responses)
- [SRS Quality Ratings](#srs-quality-ratings)

---

## Health

### `GET /api/health`

Liveness check. Used by Docker health checks.

**Response `200`**
```json
{ "status": "ok" }
```

---

## Chat & AI

### `POST /api/chat`

Send a single message and receive a complete (non-streaming) AI response. Useful for one-shot requests that don't need real-time streaming.

**Request Body**
```json
{
  "message": "Explain consistent hashing",
  "context": "Optional system context string prepended to the system instruction",
  "history": [
    { "role": "user", "content": "Hi" },
    { "role": "ai",   "content": "Hello! How can I help?" }
  ],
  "model": "gemini-3.5-flash"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | string | ✅ | The user's message |
| `context` | string | ❌ | Prepended to system instruction |
| `history` | array | ❌ | Prior turns. `role` is `"user"` or `"ai"` |
| `model` | string | ❌ | Gemini model ID. Defaults to `gemini-3.5-flash` |

**Response `200`**
```json
{ "response": "Consistent hashing is a technique..." }
```

---

### `POST /api/chat/stream`

Send a message and receive a streaming AI response via **Server-Sent Events (SSE)**. This is the primary AI endpoint used by the chat UI.

The model runs as an **agentic harness loop** with three built-in tools: `search_flashcards`, `search_guide`, and `submit_draft` (a critic–actor pattern). The full flashcard and guide databases are injected as context. Episodic memory is retrieved via semantic similarity.

**Request Body** — same shape as `POST /api/chat`.

**Response Headers**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

**Event Stream Format**

Each event is a line starting with `data: `, followed by a JSON object, followed by `\n\n`.

| Event | Description |
|-------|-------------|
| `data: {"text": "partial text"}\n\n` | Accumulated text chunk so far |
| `data: {"tool": "Running search_flashcards..."}\n\n` | Tool use notification |
| `data: [DONE]\n\n` | Stream complete |
| `data: {"error": "message"}\n\n` | Error during streaming |

**Client-side example**
```javascript
const res = await fetch('/api/chat/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message, history, model }),
  signal: abortController.signal
})
const reader = res.body.getReader()
// Read chunks and parse data: lines
```

> **Reverse proxy note**: Requires `proxy_buffering off` (Nginx) or `flush_interval -1` (Caddy) for correct streaming.

> **After-response**: A background job extracts episodic memories from the exchange using the Antigravity agent and stores them in the `episodic_memory` table.

---

### `GET /api/chat/starters`

Generate (or retrieve cached) topic-specific starter prompts for the study plan. Returns 6 randomly selected prompts from a pool of 12–15, tuned to the user's current guide progress and shadow memory.

**Query Parameters**

| Param | Required | Description |
|-------|----------|-------------|
| `pillarId` | ✅ | e.g. `compute`, `storage` |
| `topicId` | ✅ | e.g. `load-balancers` |
| `topicName` | ❌ | Human-readable fallback if topic not in constants |
| `model` | ❌ | Gemini model ID for generation |

**Response `200`**
```json
{
  "suggestions": [
    "Can you quiz me on consistent hashing?",
    "How does a load balancer handle sticky sessions?",
    "..."
  ]
}
```

Results are **cached** in the `chat_starters` table keyed by `(pillarId, topicId)` with a content-hash. Cache is invalidated when guide content or the user profile changes.

---

### `POST /api/chat/summarize`

Summarize selected chat message excerpts into clean Markdown guide notes for a specific blueprint section. Used by the Commit to Guide flow.

**Request Body**
```json
{
  "excerpts": ["AI response text 1", "AI response text 2"],
  "sectionId": "scale",
  "sectionName": "Scale Considerations",
  "topicName": "Load Balancers",
  "model": "gemini-3.5-flash"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `excerpts` | ✅ | Array of strings (AI message bodies) |
| `sectionId` | ✅ | Blueprint section ID (e.g. `scale`, `tradeoffs`) |
| `sectionName` | ❌ | Human-readable section name for prompt context |
| `topicName` | ❌ | Topic name for prompt context |
| `model` | ❌ | Gemini model ID |

**Response `200`**
```json
{ "content": "## Scale Considerations\n\nLoad balancers can be..." }
```

---

### `POST /api/chat/concept-map`

Generate a Mermaid diagram from a full chat session history. Returns a markdown code block containing `graph TD` syntax.

**Request Body**
```json
{
  "history": [
    { "role": "user", "content": "Explain CDN" },
    { "role": "ai",   "content": "A CDN is..." }
  ],
  "model": "gemini-3.5-flash"
}
```

**Response `200`**
```json
{
  "response": "```mermaid\ngraph TD\n  CDN --> EdgeNode\n  EdgeNode --> User\n```"
}
```

Requires at least 1 message in `history`.

---

### `POST /api/chat/evaluate-interceptor`

Evaluate a user's explanation of *why* a flashcard answer is correct (the "Why?" interceptor feature). Returns structured JSON with a pass/fail verdict and feedback.

**Request Body**
```json
{
  "explanation": "Because consistent hashing minimizes re-mapping when nodes are added...",
  "front": "Why do we use consistent hashing in distributed caches?",
  "back": "To minimize key remapping when nodes join or leave",
  "model": "gemini-3.5-flash"
}
```

**Response `200`**
```json
{
  "pass": true,
  "feedback": "Correct. You correctly identified the core benefit: O(K/N) remapping instead of O(K)."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `pass` | boolean | `true` if explanation demonstrates understanding |
| `feedback` | string | 1–2 sentence evaluator feedback |

---

## Flashcard Decks

### `GET /api/decks`

List all decks with card counts, SRS state counts, and computed progress.

**Response `200`** — Array of deck objects:
```json
[
  {
    "id": "uuid",
    "name": "Distributed Systems",
    "description": "CAP theorem, consensus, ...",
    "color_index": 2,
    "tags": "systems,distributed",
    "settings": {
      "new_limit": 20,
      "review_limit": 200,
      "steps": "1m 10m",
      "lapse_steps": "10m",
      "easy_bonus": 1.3
    },
    "card_count": 42,
    "new_count": 10,
    "learn_count": 5,
    "due_count": 7,
    "progress": 64,
    "last_studied": "Yesterday",
    "created_at": "2024-01-15T10:30:00.000Z",
    "updated_at": "2024-01-16T09:00:00.000Z"
  }
]
```

---

### `POST /api/decks`

Create a new deck.

**Request Body**
```json
{
  "name": "Distributed Systems",
  "description": "CAP theorem, consensus, replication",
  "color_index": 2,
  "tags": "systems,distributed"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | ✅ | Deck display name |
| `description` | ❌ | Optional deck description |
| `color_index` | ❌ | Integer 0–7, maps to a preset color |
| `tags` | ❌ | Comma-separated tag strings |

**Response `201`** — The created deck object (same shape as list item, without computed counts).

---

### `GET /api/decks/:id`

Get a single deck with all its cards (plus per-card SRS previews).

**Response `200`**
```json
{
  "id": "uuid",
  "name": "Distributed Systems",
  "settings": { ... },
  "cards": [
    {
      "id": "card-uuid",
      "deck_id": "uuid",
      "front": "What is the CAP theorem?",
      "back": "A distributed system can only guarantee 2 of: Consistency, Availability, Partition Tolerance",
      "state": 2,
      "ease_factor": 2.5,
      "interval": 4,
      "repetitions": 3,
      "next_review": "2024-01-20T10:00:00.000Z",
      "last_reviewed": "2024-01-16T09:00:00.000Z",
      "learning_step": 0,
      "position": 1,
      "srs_previews": {
        "again": "10m",
        "hard": "15m",
        "good": "4d",
        "easy": "6d"
      }
    }
  ],
  "new_count": 10,
  "learn_count": 5,
  "due_count": 7,
  "progress": 64,
  "last_studied": "Yesterday"
}
```

**Response `404`** if deck not found.

---

### `PUT /api/decks/:id`

Update deck metadata (name, description, color, tags). All fields are optional — omitted fields are not changed.

**Request Body**
```json
{
  "name": "Updated Name",
  "description": "New description",
  "color_index": 3,
  "tags": "systems,updated"
}
```

**Response `200`** — Updated deck object.

---

### `PUT /api/decks/:id/settings`

Update per-deck SRS scheduler settings.

**Request Body**
```json
{
  "new_limit": 20,
  "review_limit": 200,
  "steps": "1m 10m",
  "lapse_steps": "10m",
  "easy_bonus": 1.3
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `new_limit` | integer | `20` | Max new cards introduced per day |
| `review_limit` | integer | `200` | Max review cards per day |
| `steps` | string | `"1m 10m"` | Space-separated learning step intervals. Suffix `m` = minutes, `h` = hours |
| `lapse_steps` | string | `"10m"` | Re-learning step intervals after a lapse |
| `easy_bonus` | float | `1.3` | Multiplier applied to the interval for "Easy" ratings |

**Response `200`**
```json
{ "id": "uuid", "settings": { ... } }
```

---

### `DELETE /api/decks/:id`

Delete a deck and all its cards (cascade delete).

**Response `204`** — No content.

---

## Flashcards

### `GET /api/decks/all/cards/due`

Get all due cards across every deck, shuffled (Fisher-Yates). Respects per-deck `new_limit` and `review_limit` settings. Used by the Interleaved Review page.

Card ordering priority within each deck: learning/relearning → review → new.

**Response `200`** — Array of card objects, each with:
- All standard card fields
- `deckName` — the parent deck's name
- `srs_previews` — interval previews for all 4 ratings

---

### `GET /api/decks/:deckId/cards`

Get all cards for a deck (no SRS filtering, no limit). Ordered by `position`.

**Response `200`** — Array of card objects.

---

### `GET /api/decks/:deckId/cards/due`

Get due cards for a single deck, respecting daily limits. Card ordering: learning/relearning → review → new.

**Response `200`** — Array of card objects, each with `deckName` and `srs_previews`.

---

### `POST /api/decks/:deckId/cards`

Create a new card in a deck.

**Request Body**
```json
{
  "front": "What is eventual consistency?",
  "back": "Nodes may return stale data but will converge given enough time",
  "prerequisite_id": null
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `front` | ✅ | Card front/question text |
| `back` | ✅ | Card back/answer text |
| `prerequisite_id` | ❌ | Card UUID that must be mastered (state=2, ease≥2.5) before this card appears |

**Response `201`** — The created card object.

---

### `PUT /api/decks/:deckId/cards/:cardId`

Update card content or ordering.

**Request Body**
```json
{
  "front": "Updated question",
  "back": "Updated answer",
  "position": 5,
  "prerequisite_id": null
}
```

All fields are optional. SRS state fields (`ease_factor`, `interval`, etc.) are not modified by this endpoint — use the review endpoint for that.

**Response `200`** — Updated card object.

---

### `PUT /api/decks/:deckId/cards/:cardId/review`

Submit a review rating for a card. Runs the SM-2 SRS algorithm and persists the next state. Also increments the study session heatmap counter for today.

**Request Body**
```json
{
  "quality": 4,
  "confidence": "medium"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `quality` | integer 0–5 | ✅ | See [SRS Quality Ratings](#srs-quality-ratings) |
| `confidence` | string | ❌ | `"low"`, `"medium"`, or `"high"`. Used for Hypercorrection Penalty on failure. Defaults to `"medium"` |

**Response `200`** — Updated card object with recalculated SRS fields and fresh `srs_previews`.

---

### `DELETE /api/decks/:deckId/cards/:cardId`

Delete a single card.

**Response `204`** — No content.

---

## Whiteboard Boards

### `GET /api/boards`

List all boards (metadata only, no canvas data).

**Response `200`**
```json
[
  {
    "id": "uuid",
    "name": "URL Shortener Design",
    "created_at": "2024-01-15T10:30:00.000Z",
    "updated_at": "2024-01-16T09:00:00.000Z"
  }
]
```

---

### `POST /api/boards`

Create a new board.

**Request Body**
```json
{
  "name": "URL Shortener Design",
  "data": { "nodes": [], "edges": [] }
}
```

**Response `201`** — Created board with parsed `data` object.

---

### `GET /api/boards/:id`

Get a board with full canvas data.

**Response `200`**
```json
{
  "id": "uuid",
  "name": "URL Shortener Design",
  "data": {
    "nodes": [
      { "id": "n1", "type": "load_balancer", "x": 100, "y": 200, "label": "Load Ba..." }
    ],
    "edges": [
      { "id": "e1", "from": "n1", "to": "n2" }
    ]
  },
  "created_at": "...",
  "updated_at": "..."
}
```

**Response `404`** if board not found.

---

### `PUT /api/boards/:id`

Update a board. Supports partial updates (omit `name` or `data` to leave them unchanged).

**Request Body**
```json
{
  "name": "Renamed Board",
  "data": { "nodes": [...], "edges": [...] }
}
```

**Response `200`** — Updated board.

---

### `DELETE /api/boards/:id`

Delete a board.

**Response `204`** — No content.

---

## Guide Content

### `GET /api/guide-content/progress`

Returns a flat map of all filled guide sections. Used by the Study Plan sidebar to compute per-pillar progress percentages.

**Response `200`**
```json
{
  "compute__load-balancers__scale": true,
  "compute__load-balancers__tradeoffs": true,
  "storage__sql__primitives": true
}
```

Keys are formatted as `{pillarId}__{topicId}__{sectionId}`.

---

### `GET /api/guide-content/export`

Export all committed guide content as a single Markdown file download.

**Response `200`**
- `Content-Type: text/markdown`
- `Content-Disposition: attachment; filename="system_design_guide.md"`
- Body: Markdown document organized by Pillar → Topic → Section

---

### `GET /api/guide-content/:pillarId/:topicId`

Get all section content for a topic. Returns only sections that have content in the database.

**Response `200`**
```json
{
  "scale": {
    "content": "## Scale Considerations\n\n...",
    "committedAt": "2024-01-15T10:30:00.000Z"
  },
  "tradeoffs": {
    "content": "## Trade-offs\n\n...",
    "committedAt": "2024-01-15T11:00:00.000Z"
  }
}
```

---

### `GET /api/guide-content/:pillarId/:topicId/:sectionId`

Get content for a single section. Returns `{ content: "", committedAt: null }` if the section has never been committed.

**Response `200`**
```json
{
  "content": "## Scale Considerations\n\n...",
  "committedAt": "2024-01-15T10:30:00.000Z"
}
```

---

### `PUT /api/guide-content/:pillarId/:topicId/:sectionId`

Upsert (create or replace) the content for a guide section.

**Request Body**
```json
{ "content": "## Scale Considerations\n\nA load balancer..." }
```

**Response `200`**
```json
{ "ok": true }
```

---

### `DELETE /api/guide-content/:pillarId/:topicId/:sectionId`

Clear a guide section's content (sets it back to empty).

**Response `200`**
```json
{ "ok": true }
```

---

## User Profile (Shadow Memory)

### `GET /api/profile`

Get the user's shadow memory profile text.

**Response `200`**
```json
{ "profileText": "Interviewing at Google in 6 weeks. Strong in distributed systems, weak in storage..." }
```

---

### `PUT /api/profile`

Overwrite the entire profile text. The profile is injected into every AI system prompt.

**Request Body**
```json
{ "profileText": "Updated profile text..." }
```

**Response `200`**
```json
{ "success": true, "profileText": "Updated profile text..." }
```

---

### `DELETE /api/profile`

Clear all shadow memory.

**Response `200`**
```json
{ "success": true, "message": "Profile cleared" }
```

---

## Configuration

### `GET /api/config`

Get all config values. The `gemini_api_key` is **masked** (first 8 chars + last 4 chars shown).

**Response `200`**
```json
{
  "gemini_api_key": "AIzaSyAB...Xy1z",
  "api_key_configured": true
}
```

---

### `PUT /api/config`

Update one or more config values. Pass any key-value pairs. The `gemini_api_key` key is handled specially (stored as-is, not as a string coercion).

**Request Body**
```json
{ "gemini_api_key": "AIzaSy..." }
```

**Response `200`**
```json
{ "success": true }
```

---

### `POST /api/config/test-key`

Validate a Gemini API key by making a minimal live API call. If valid, **also saves the key** to the database.

**Request Body**
```json
{ "key": "AIzaSy..." }
```

**Response `200`**
```json
{ "valid": true }
```

**Response `400`**
```json
{ "valid": false, "message": "Invalid API key" }
```

---

## Search

### `GET /api/search?q=:query`

Unified full-text search across all content types. Returns up to 10 results per domain.

**Query Parameters**

| Param | Required | Description |
|-------|----------|-------------|
| `q` | ✅ | Search query string (minimum 1 character) |

**Response `200`**
```json
{
  "flashcards": [
    { "id": "uuid", "deck_id": "uuid", "front": "...", "back": "...", "state": 2 }
  ],
  "guideContent": [
    { "pillar_id": "compute", "topic_id": "load-balancers", "section_id": "scale", "content": "..." }
  ],
  "boards": [
    { "id": "uuid", "name": "URL Shortener Design" }
  ],
  "decks": [
    { "id": "uuid", "name": "Distributed Systems", "description": "...", "tags": "..." }
  ]
}
```

Returns empty arrays for all domains if `q` is blank.

---

## Study Sessions

### `GET /api/study_sessions`

Get all study session activity records (used by the activity heatmap). One record per calendar day, incremented each time a card is reviewed.

**Response `200`**
```json
[
  { "date": "2024-01-15", "count": 12 },
  { "date": "2024-01-16", "count": 7 }
]
```

Ordered by date ascending.

---

## System

### `GET /api/system/stats`

Get database row counts and profile size for the Settings diagnostics panel.

**Response `200`**
```json
{
  "flashcardsCount": 142,
  "decksCount": 8,
  "boardsCount": 3,
  "guideCount": 24,
  "cachedStartersCount": 12,
  "profileSize": 487
}
```

| Field | Description |
|-------|-------------|
| `flashcardsCount` | Total flashcards across all decks |
| `decksCount` | Total decks |
| `boardsCount` | Total whiteboards |
| `guideCount` | Total committed guide sections |
| `cachedStartersCount` | Cached topic starter prompt sets |
| `profileSize` | Character length of the shadow memory profile |

---

### `POST /api/system/clear-cache`

Flush all cached AI starter prompts. Forces fresh generation on next topic visit.

**Response `200`**
```json
{ "success": true, "message": "AI Starter Cache cleared." }
```

---

### `GET /api/system/export-db`

Download the raw SQLite database file as a binary attachment.

**Response `200`**
- `Content-Disposition: attachment; filename="toolbox_backup.db"`
- Body: Binary SQLite file

---

## Error Responses

All errors return a JSON body with a `message` field:

```json
{ "message": "Human-readable error description" }
```

| Status | Meaning |
|--------|---------|
| `400` | Bad request — missing required field or invalid value |
| `404` | Resource not found |
| `500` | Internal server error (check server logs) |

A `400` with `"Gemini API key not configured"` means no key is set — go to Settings to add one.

---

## SRS Quality Ratings

The review endpoint accepts a `quality` integer from 0–5, mapped to button labels in the UI:

| `quality` | UI Label | Meaning |
|-----------|----------|---------|
| `0` or `1` | **Again** | Complete failure — resets card to learning |
| `2` or `3` | **Hard** | Passed with difficulty — shorter interval, ease penalty |
| `4` | **Good** | Solid recall — standard interval increase |
| `5` | **Easy** | Effortless recall — longer interval with easy bonus |

The SM-2 algorithm uses these to update `ease_factor`, `interval`, `state`, and `next_review`. See [SRS Algorithm](./srs-algorithm.md) for the full implementation details.
