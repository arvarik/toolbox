import { Router, type Request, type Response } from "express";
import { v4 as uuid } from "uuid";
import db from "../db.ts";
import { scopeOf, type Scope } from "../platform/tenancy/scope.ts";
import { ensureDefaultSystemDesignKit } from "../kits/kitsSchema.ts";
import {
  calculateNextSrsState,
  getCardPreviews,
  formatRelativeTime,
  parseDeckSettings,
  type DeckSettings,
} from "../srs/scheduler.ts";
import { planRemediation, type RemediationCardRow } from "../graph/remediation.ts";
import logger from "../utils/logger.ts";

const router = Router();

interface DeckRow {
  id: string;
  ownerId: string;
  kit_id: string;
  name: string;
  description: string;
  color_index: number;
  tags: string;
  settings: string;
  created_at: string;
  updated_at: string;
}

interface FlashcardRow {
  id: string;
  ownerId: string;
  deck_id: string;
  node_id: string | null;
  front: string;
  back: string;
  position: number;
  ease_factor: number;
  interval: number;
  repetitions: number;
  next_review: string | null;
  last_reviewed: string | null;
  state: number;
  learning_step: number;
  prerequisite_id: string | null;
  embedding: string | null;
  source_pillar_id: string | null;
  source_topic_id: string | null;
  source_section_id: string | null;
  is_reverse: number;
  reverse_of_id: string | null;
  created_at: string;
  updated_at: string;
  remediation_reason?: string;
  remediation_node?: string | null;
  deckName?: string;
  srs_previews?: ReturnType<typeof getCardPreviews>;
}

function getOwnedDeck(scope: Scope, deckId: string): DeckRow | undefined {
  return db
    .prepare("SELECT * FROM decks WHERE ownerId = ? AND id = ?")
    .get(scope.ownerId, deckId) as DeckRow | undefined;
}

/**
 * Prerequisite gate that NEVER deadlocks if the prerequisite card was deleted:
 * unlocked when prerequisite_id is empty OR there is NO existing prerequisite
 * card for this owner whose mastery falls short of (state = 2 AND ease_factor >= 2.5).
 */
const PREREQ_UNLOCKED_SQL = `
  (prerequisite_id IS NULL OR prerequisite_id = '' OR NOT EXISTS (
    SELECT 1 FROM flashcards p
    WHERE p.ownerId = flashcards.ownerId
      AND p.id = flashcards.prerequisite_id
      AND NOT (p.state = 2 AND p.ease_factor >= 2.5)
  ))
`;

function applyRemediation<T extends FlashcardRow>(
  scope: Scope,
  sessionCards: T[],
  deckId: string | null,
): Array<T | FlashcardRow> {
  const rows = (
    deckId
      ? db
          .prepare(
            `SELECT f.*, r.reason AS remediation_reason, r.node_name AS remediation_node
             FROM remediation_queue r
             JOIN flashcards f ON f.ownerId = r.ownerId AND f.id = r.card_id
             WHERE r.ownerId = ? AND r.resolved_at IS NULL AND f.deck_id = ?
             ORDER BY r.created_at ASC
             LIMIT 10`,
          )
          .all(scope.ownerId, deckId)
      : db
          .prepare(
            `SELECT f.*, r.reason AS remediation_reason, r.node_name AS remediation_node
             FROM remediation_queue r
             JOIN flashcards f ON f.ownerId = r.ownerId AND f.id = r.card_id
             WHERE r.ownerId = ? AND r.resolved_at IS NULL
             ORDER BY r.created_at ASC
             LIMIT 10`,
          )
          .all(scope.ownerId)
  ) as FlashcardRow[];

  if (rows.length === 0) return sessionCards;

  const meta = new Map<string, FlashcardRow>();
  for (const row of rows) {
    if (!meta.has(row.id)) meta.set(row.id, row);
  }

  const leading: Array<T | FlashcardRow> = [];
  const rest: Array<T | FlashcardRow> = [];
  const present = new Set<string>();
  for (const card of sessionCards) {
    const tag = meta.get(card.id);
    if (tag) {
      present.add(card.id);
      leading.push({
        ...card,
        is_remediation: 1,
        remediation_reason: tag.remediation_reason,
        remediation_node: tag.remediation_node,
      });
    } else {
      rest.push(card);
    }
  }

  const missing = rows
    .filter((row) => !present.has(row.id))
    .map((row) => ({ ...row, is_remediation: 1 }));

  return [...missing, ...leading, ...rest];
}

router.get("/", (req, res) => {
  const scope = scopeOf(req);
  const kit = ensureDefaultSystemDesignKit(db, scope);

  const results = db
    .prepare(
      `SELECT d.*,
         COUNT(f.id) as card_count,
         SUM(CASE WHEN f.id IS NOT NULL AND (f.state = 0 OR f.state IS NULL) THEN 1 ELSE 0 END) as new_count,
         SUM(CASE WHEN f.state IN (1, 3) THEN 1 ELSE 0 END) as learn_count,
         SUM(CASE WHEN f.state = 2 AND (f.next_review IS NULL OR f.next_review <= datetime('now')) THEN 1 ELSE 0 END) as due_count,
         MAX(f.last_reviewed) as last_reviewed_raw,
         SUM(CASE WHEN f.repetitions > 0 THEN 1 ELSE 0 END) as reviewed_count
       FROM decks d
       LEFT JOIN flashcards f ON f.ownerId = d.ownerId AND f.deck_id = d.id
       WHERE d.ownerId = ? AND d.kit_id = ?
       GROUP BY d.id
       ORDER BY d.updated_at DESC`,
    )
    .all(scope.ownerId, kit.id) as Array<
    DeckRow & {
      card_count: number;
      new_count: number;
      learn_count: number;
      due_count: number;
      last_reviewed_raw: string | null;
      reviewed_count: number;
    }
  >;

  const decks = results.map((row) => {
    const cardCount = row.card_count || 0;
    const reviewedCount = row.reviewed_count || 0;
    const progress =
      cardCount > 0 ? Math.round((reviewedCount / cardCount) * 100) : 0;

    const { last_reviewed_raw, reviewed_count: _rev, ...deck } = row;
    const settings = parseDeckSettings(row.settings);

    return {
      ...deck,
      new_count: row.new_count || 0,
      learn_count: row.learn_count || 0,
      due_count: row.due_count || 0,
      settings,
      progress,
      last_studied: formatRelativeTime(last_reviewed_raw),
    };
  });

  res.json(decks);
});

router.get("/all/cards/due", (req, res) => {
  const scope = scopeOf(req);
  const allDecks = db
    .prepare("SELECT id, name, settings FROM decks WHERE ownerId = ?")
    .all(scope.ownerId) as Array<{ id: string; name: string; settings: string }>;

  let allDueCards: Array<FlashcardRow & Record<string, unknown>> = [];

  const getNewReviewedToday = db.prepare(
    `SELECT COUNT(*) as count FROM flashcards
     WHERE ownerId = ? AND deck_id = ?
       AND last_reviewed IS NOT NULL
       AND date(last_reviewed, 'localtime') = date('now', 'localtime')
       AND repetitions = 1`,
  );

  const getReviewsToday = db.prepare(
    `SELECT COUNT(*) as count FROM flashcards
     WHERE ownerId = ? AND deck_id = ?
       AND last_reviewed IS NOT NULL
       AND date(last_reviewed, 'localtime') = date('now', 'localtime')
       AND repetitions > 1`,
  );

  const getLearningCards = db.prepare(
    `SELECT * FROM flashcards
     WHERE ownerId = ? AND deck_id = ?
       AND state IN (1, 3)
       AND (next_review IS NULL OR next_review <= datetime('now'))
       AND ${PREREQ_UNLOCKED_SQL}
     ORDER BY next_review ASC`,
  );

  const getReviewCards = db.prepare(
    `SELECT * FROM flashcards
     WHERE ownerId = ? AND deck_id = ?
       AND state = 2
       AND (next_review IS NULL OR next_review <= datetime('now'))
       AND ${PREREQ_UNLOCKED_SQL}
     ORDER BY next_review ASC
     LIMIT ?`,
  );

  const getNewCards = db.prepare(
    `SELECT * FROM flashcards
     WHERE ownerId = ? AND deck_id = ?
       AND state = 0
       AND next_review IS NULL
       AND ${PREREQ_UNLOCKED_SQL}
     ORDER BY position ASC, id ASC
     LIMIT ?`,
  );

  const deckNames = new Map<string, string>(allDecks.map((d) => [d.id, d.name]));
  const deckSettings = new Map<string, DeckSettings>(
    allDecks.map((d) => [d.id, parseDeckSettings(d.settings)]),
  );

  for (const deck of allDecks) {
    const deckId = deck.id;
    const settings = deckSettings.get(deckId)!;

    const newReviewedToday = (
      getNewReviewedToday.get(scope.ownerId, deckId) as { count: number }
    ).count;
    const reviewsToday = (
      getReviewsToday.get(scope.ownerId, deckId) as { count: number }
    ).count;

    const learningCards = getLearningCards.all(
      scope.ownerId,
      deckId,
    ) as FlashcardRow[];

    const remainingReviews = Math.max(0, settings.review_limit - reviewsToday);
    const reviewCards =
      remainingReviews > 0
        ? (getReviewCards.all(
            scope.ownerId,
            deckId,
            remainingReviews,
          ) as FlashcardRow[])
        : [];

    const remainingNew = Math.max(0, settings.new_limit - newReviewedToday);
    const newCards =
      remainingNew > 0
        ? (getNewCards.all(scope.ownerId, deckId, remainingNew) as FlashcardRow[])
        : [];

    const combined = [...learningCards, ...reviewCards, ...newCards];
    const combinedWithPreviews = combined.map((c) => ({
      ...c,
      deckName: deck.name,
      srs_previews: getCardPreviews(c, settings),
    }));

    allDueCards = [...allDueCards, ...combinedWithPreviews];
  }

  for (let i = allDueCards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allDueCards[i], allDueCards[j]] = [allDueCards[j], allDueCards[i]];
  }

  const withRemediation = applyRemediation(scope, allDueCards, null).map((c) => ({
    ...c,
    deckName: (c.deckName as string | undefined) ?? (deckNames.get(c.deck_id) || ""),
    srs_previews:
      c.srs_previews ??
      getCardPreviews(c, deckSettings.get(c.deck_id) || parseDeckSettings(null)),
  }));

  res.json(withRemediation);
});

router.get("/:id", (req, res) => {
  const scope = scopeOf(req);
  const deck = getOwnedDeck(scope, req.params.id);
  if (!deck) {
    res.status(404).json({ message: "Deck not found" });
    return;
  }

  const settings = parseDeckSettings(deck.settings);
  const cards = db
    .prepare(
      "SELECT * FROM flashcards WHERE ownerId = ? AND deck_id = ? ORDER BY position",
    )
    .all(scope.ownerId, req.params.id) as FlashcardRow[];

  const cardsWithPreviews = cards.map((c) => ({
    ...c,
    srs_previews: getCardPreviews(c, settings),
  }));

  const newCount = cards.filter((c) => (c.state || 0) === 0).length;
  const learnCount = cards.filter((c) => c.state === 1 || c.state === 3).length;
  const dueCount = cards.filter(
    (c) =>
      (c.state || 0) === 2 &&
      (!c.next_review || new Date(c.next_review) <= new Date()),
  ).length;

  const reviewedCount = cards.filter((c) => c.repetitions > 0).length;
  const progress =
    cards.length > 0 ? Math.round((reviewedCount / cards.length) * 100) : 0;
  const maxLastReviewed = cards.reduce<string | null>((max, c) => {
    if (!c.last_reviewed) return max;
    return !max || new Date(c.last_reviewed) > new Date(max)
      ? c.last_reviewed
      : max;
  }, null);

  res.json({
    ...deck,
    settings,
    cards: cardsWithPreviews,
    new_count: newCount,
    learn_count: learnCount,
    due_count: dueCount,
    progress,
    last_studied: formatRelativeTime(maxLastReviewed),
  });
});

router.post("/", (req, res) => {
  const scope = scopeOf(req);
  const kit = ensureDefaultSystemDesignKit(db, scope);
  const { name, description, color_index, tags } = req.body as {
    name?: string;
    description?: string;
    color_index?: number;
    tags?: string;
  };
  if (!name) {
    res.status(400).json({ message: "Name is required" });
    return;
  }

  const id = uuid();
  db.prepare(
    "INSERT INTO decks (id, ownerId, kit_id, name, description, color_index, tags) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    scope.ownerId,
    kit.id,
    name,
    description || "",
    color_index || 0,
    tags || "",
  );

  const deck = getOwnedDeck(scope, id);
  res.status(201).json(deck);
});

router.put("/:id", (req, res) => {
  const scope = scopeOf(req);
  const { name, description, color_index, tags } = req.body as {
    name?: string;
    description?: string;
    color_index?: number;
    tags?: string;
  };
  const existing = getOwnedDeck(scope, req.params.id);
  if (!existing) {
    res.status(404).json({ message: "Deck not found" });
    return;
  }

  db.prepare(
    `UPDATE decks SET
       name = COALESCE(?, name),
       description = COALESCE(?, description),
       color_index = COALESCE(?, color_index),
       tags = COALESCE(?, tags),
       updated_at = datetime('now')
     WHERE ownerId = ? AND id = ?`,
  ).run(
    name ?? null,
    description ?? null,
    color_index ?? null,
    tags ?? null,
    scope.ownerId,
    req.params.id,
  );

  res.json(getOwnedDeck(scope, req.params.id));
});

router.put("/:deckId/settings", (req, res) => {
  const scope = scopeOf(req);
  const { new_limit, review_limit, steps, lapse_steps, easy_bonus } =
    req.body as {
      new_limit?: number | string;
      review_limit?: number | string;
      steps?: string;
      lapse_steps?: string;
      easy_bonus?: number | string;
    };

  const existing = getOwnedDeck(scope, req.params.deckId);
  if (!existing) {
    res.status(404).json({ message: "Deck not found" });
    return;
  }

  const currentSettings = parseDeckSettings(existing.settings);
  const updatedSettings: DeckSettings = {
    ...currentSettings,
    new_limit:
      new_limit !== undefined
        ? parseInt(String(new_limit), 10)
        : currentSettings.new_limit || 20,
    review_limit:
      review_limit !== undefined
        ? parseInt(String(review_limit), 10)
        : currentSettings.review_limit || 200,
    steps:
      steps !== undefined ? steps.trim() : currentSettings.steps || "1m 10m",
    lapse_steps:
      lapse_steps !== undefined
        ? lapse_steps.trim()
        : currentSettings.lapse_steps || "10m",
    easy_bonus:
      easy_bonus !== undefined
        ? parseFloat(String(easy_bonus))
        : currentSettings.easy_bonus || 1.3,
  };

  db.prepare(
    `UPDATE decks SET
       settings = ?,
       updated_at = datetime('now')
     WHERE ownerId = ? AND id = ?`,
  ).run(JSON.stringify(updatedSettings), scope.ownerId, req.params.deckId);

  res.json({ id: req.params.deckId, settings: updatedSettings });
});

router.delete("/:id", (req, res) => {
  const scope = scopeOf(req);
  const existing = getOwnedDeck(scope, req.params.id);
  if (!existing) {
    res.status(404).json({ message: "Deck not found" });
    return;
  }

  db.prepare("DELETE FROM decks WHERE ownerId = ? AND id = ?").run(
    scope.ownerId,
    req.params.id,
  );
  res.status(204).send();
});

router.get("/:deckId/cards", (req, res) => {
  const scope = scopeOf(req);
  if (!getOwnedDeck(scope, req.params.deckId)) {
    res.status(404).json({ message: "Deck not found" });
    return;
  }
  const cards = db
    .prepare(
      "SELECT * FROM flashcards WHERE ownerId = ? AND deck_id = ? ORDER BY position",
    )
    .all(scope.ownerId, req.params.deckId);
  res.json(cards);
});

router.get("/:deckId/cards/due", (req, res) => {
  const scope = scopeOf(req);
  const deckId = req.params.deckId;
  const deck = getOwnedDeck(scope, deckId);
  if (!deck) {
    res.status(404).json({ message: "Deck not found" });
    return;
  }

  const settings = parseDeckSettings(deck.settings);

  const newReviewedToday = (
    db
      .prepare(
        `SELECT COUNT(*) as count FROM flashcards
         WHERE ownerId = ? AND deck_id = ?
           AND last_reviewed IS NOT NULL
           AND date(last_reviewed, 'localtime') = date('now', 'localtime')
           AND repetitions = 1`,
      )
      .get(scope.ownerId, deckId) as { count: number }
  ).count;

  const reviewsToday = (
    db
      .prepare(
        `SELECT COUNT(*) as count FROM flashcards
         WHERE ownerId = ? AND deck_id = ?
           AND last_reviewed IS NOT NULL
           AND date(last_reviewed, 'localtime') = date('now', 'localtime')
           AND repetitions > 1`,
      )
      .get(scope.ownerId, deckId) as { count: number }
  ).count;

  const learningCards = db
    .prepare(
      `SELECT * FROM flashcards
       WHERE ownerId = ? AND deck_id = ?
         AND state IN (1, 3)
         AND (next_review IS NULL OR next_review <= datetime('now'))
         AND ${PREREQ_UNLOCKED_SQL}
       ORDER BY next_review ASC`,
    )
    .all(scope.ownerId, deckId) as FlashcardRow[];

  const remainingReviews = Math.max(0, settings.review_limit - reviewsToday);
  const reviewCards =
    remainingReviews > 0
      ? (db
          .prepare(
            `SELECT * FROM flashcards
             WHERE ownerId = ? AND deck_id = ?
               AND state = 2
               AND (next_review IS NULL OR next_review <= datetime('now'))
               AND ${PREREQ_UNLOCKED_SQL}
             ORDER BY next_review ASC
             LIMIT ?`,
          )
          .all(scope.ownerId, deckId, remainingReviews) as FlashcardRow[])
      : [];

  const remainingNew = Math.max(0, settings.new_limit - newReviewedToday);
  const newCards =
    remainingNew > 0
      ? (db
          .prepare(
            `SELECT * FROM flashcards
             WHERE ownerId = ? AND deck_id = ?
               AND state = 0
               AND next_review IS NULL
               AND ${PREREQ_UNLOCKED_SQL}
             ORDER BY position ASC, id ASC
             LIMIT ?`,
          )
          .all(scope.ownerId, deckId, remainingNew) as FlashcardRow[])
      : [];

  const combined = applyRemediation(
    scope,
    [...learningCards, ...reviewCards, ...newCards],
    deckId,
  );

  const combinedWithPreviews = combined.map((c) => ({
    ...c,
    deckName: deck.name,
    srs_previews: getCardPreviews(c, settings),
  }));

  res.json(combinedWithPreviews);
});

router.post("/:deckId/cards/check-duplicates", (req, res) => {
  const scope = scopeOf(req);
  if (!getOwnedDeck(scope, req.params.deckId)) {
    res.status(404).json({ message: "Deck not found" });
    return;
  }
  const { cards } = req.body as {
    cards?: Array<{ front: string; back: string } & Record<string, unknown>>;
  };
  if (!cards || !Array.isArray(cards)) {
    res.status(400).json({ message: "cards array is required" });
    return;
  }

  const existingCards = db
    .prepare(
      "SELECT id, front, back FROM flashcards WHERE ownerId = ? AND deck_id = ?",
    )
    .all(scope.ownerId, req.params.deckId) as Array<{
    id: string;
    front: string;
    back: string;
  }>;

  const trigrams = (text: string): Set<string> => {
    const normalized = text
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .trim();
    const tris = new Set<string>();
    for (let i = 0; i <= normalized.length - 3; i++) {
      tris.add(normalized.substring(i, i + 3));
    }
    return tris;
  };

  const jaccard = (setA: Set<string>, setB: Set<string>): number => {
    if (setA.size === 0 && setB.size === 0) return 1;
    let intersection = 0;
    for (const item of setA) {
      if (setB.has(item)) intersection++;
    }
    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  };

  const existingTrigrams = existingCards.map((c) => ({
    card: c,
    frontTri: trigrams(c.front),
    combinedTri: trigrams(`${c.front} ${c.back}`),
  }));

  const results = cards.map((incoming) => {
    const incomingFrontTri = trigrams(incoming.front || "");
    const incomingCombinedTri = trigrams(
      `${incoming.front || ""} ${incoming.back || ""}`,
    );

    let bestMatch: { front: string; back: string } | null = null;
    let bestSimilarity = 0;

    for (const existing of existingTrigrams) {
      const frontSim = jaccard(incomingFrontTri, existing.frontTri);
      const combinedSim = jaccard(incomingCombinedTri, existing.combinedTri);
      const maxSim = Math.max(frontSim, combinedSim);

      if (maxSim > bestSimilarity) {
        bestSimilarity = maxSim;
        bestMatch = existing.card;
      }
    }

    const isDuplicate = bestSimilarity > 0.55;
    return {
      ...incoming,
      isDuplicate,
      similarity: Math.round(bestSimilarity * 100),
      duplicateOf:
        isDuplicate && bestMatch
          ? { front: bestMatch.front, back: bestMatch.back }
          : null,
    };
  });

  res.json({ results });
});

function resolveValidPrereqId(
  scope: Scope,
  prereqId: unknown,
  selfId?: string,
): string | null {
  if (typeof prereqId !== "string" || !prereqId.trim()) return null;
  const candidate = prereqId.trim();
  if (selfId && candidate === selfId) return null;
  const exists = db
    .prepare("SELECT 1 FROM flashcards WHERE ownerId = ? AND id = ?")
    .get(scope.ownerId, candidate);
  return exists ? candidate : null;
}

router.post("/:deckId/cards", (req, res) => {
  const scope = scopeOf(req);
  if (!getOwnedDeck(scope, req.params.deckId)) {
    res.status(404).json({ message: "Deck not found" });
    return;
  }

  const {
    front,
    back,
    node_id,
    prerequisite_id,
    source_pillar_id,
    source_topic_id,
    source_section_id,
    is_reverse,
    reverse_of_id,
  } = req.body as Record<string, unknown>;

  if (!front || !back) {
    res.status(400).json({ message: "Front and back are required" });
    return;
  }

  const id = uuid();
  const maxPos = db
    .prepare(
      "SELECT MAX(position) as max FROM flashcards WHERE ownerId = ? AND deck_id = ?",
    )
    .get(scope.ownerId, req.params.deckId) as { max: number | null } | undefined;

  const validPrereq = resolveValidPrereqId(scope, prerequisite_id, id);

  db.prepare(
    `INSERT INTO flashcards (
       id, ownerId, deck_id, node_id, front, back, position,
       prerequisite_id, source_pillar_id, source_topic_id, source_section_id,
       is_reverse, reverse_of_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    scope.ownerId,
    req.params.deckId,
    (node_id as string | undefined) || null,
    String(front),
    String(back),
    (maxPos?.max || 0) + 1,
    validPrereq,
    (source_pillar_id as string | undefined) || null,
    (source_topic_id as string | undefined) || null,
    (source_section_id as string | undefined) || null,
    is_reverse ? 1 : 0,
    (reverse_of_id as string | undefined) || null,
  );

  db.prepare(
    "UPDATE decks SET updated_at = datetime('now') WHERE ownerId = ? AND id = ?",
  ).run(scope.ownerId, req.params.deckId);

  const card = db
    .prepare("SELECT * FROM flashcards WHERE ownerId = ? AND id = ?")
    .get(scope.ownerId, id);
  res.status(201).json(card);
});

router.put("/:deckId/cards/:cardId", (req, res) => {
  const scope = scopeOf(req);
  if (!getOwnedDeck(scope, req.params.deckId)) {
    res.status(404).json({ message: "Deck not found" });
    return;
  }

  const { front, back, position, prerequisite_id } = req.body as {
    front?: string;
    back?: string;
    position?: number;
    prerequisite_id?: string | null;
  };

  const current = db
    .prepare(
      "SELECT prerequisite_id FROM flashcards WHERE ownerId = ? AND id = ? AND deck_id = ?",
    )
    .get(scope.ownerId, req.params.cardId, req.params.deckId) as
    | { prerequisite_id: string | null }
    | undefined;
  if (!current) {
    res.status(404).json({ message: "Card not found" });
    return;
  }

  const newPrereq =
    prerequisite_id !== undefined
      ? resolveValidPrereqId(scope, prerequisite_id, req.params.cardId)
      : current.prerequisite_id;

  db.prepare(
    `UPDATE flashcards SET
       front = COALESCE(?, front),
       back = COALESCE(?, back),
       position = COALESCE(?, position),
       prerequisite_id = ?,
       updated_at = datetime('now')
     WHERE ownerId = ? AND id = ? AND deck_id = ?`,
  ).run(
    front ?? null,
    back ?? null,
    position ?? null,
    newPrereq,
    scope.ownerId,
    req.params.cardId,
    req.params.deckId,
  );

  const card = db
    .prepare("SELECT * FROM flashcards WHERE ownerId = ? AND id = ?")
    .get(scope.ownerId, req.params.cardId);
  res.json(card);
});

function handleReview(req: Request, res: Response): void {
  const scope = scopeOf(req);
  const kit = ensureDefaultSystemDesignKit(db, scope);
  const { quality, confidence } = req.body as {
    quality?: number;
    confidence?: string;
  };
  if (quality === undefined || quality < 0 || quality > 5) {
    res.status(400).json({ message: "Quality must be 0-5" });
    return;
  }

  const deck = getOwnedDeck(scope, String(req.params.deckId));
  if (!deck) {
    res.status(404).json({ message: "Deck not found" });
    return;
  }

  const card = db
    .prepare(
      "SELECT * FROM flashcards WHERE ownerId = ? AND id = ? AND deck_id = ?",
    )
    .get(
      scope.ownerId,
      String(req.params.cardId),
      String(req.params.deckId),
    ) as FlashcardRow | undefined;

  if (!card) {
    res.status(404).json({ message: "Card not found" });
    return;
  }

  const settings = parseDeckSettings(deck.settings);
  const updated = calculateNextSrsState(card, quality, settings, confidence);

  db.prepare(
    `UPDATE flashcards SET
       ease_factor = ?,
       interval = ?,
       repetitions = ?,
       next_review = ?,
       last_reviewed = ?,
       state = ?,
       learning_step = ?,
       updated_at = datetime('now')
     WHERE ownerId = ? AND id = ?`,
  ).run(
    updated.ease_factor,
    updated.interval,
    updated.repetitions,
    updated.next_review,
    updated.last_reviewed,
    updated.state,
    updated.learning_step,
    scope.ownerId,
    card.id,
  );

  db.prepare(
    `INSERT INTO study_sessions (ownerId, date, count)
     VALUES (?, date('now', 'localtime'), 1)
     ON CONFLICT(ownerId, date) DO UPDATE SET count = count + 1`,
  ).run(scope.ownerId);

  db.prepare(
    `UPDATE remediation_queue SET resolved_at = datetime('now')
     WHERE ownerId = ? AND card_id = ? AND resolved_at IS NULL`,
  ).run(scope.ownerId, card.id);

  const remediation: Array<{
    cardId: string;
    front: string;
    nodeName: string | null;
    reason: string;
  }> = [];

  if (quality < 3) {
    try {
      const allCards = db
        .prepare(
          "SELECT id, node_id, front, back, state, ease_factor, interval, next_review, prerequisite_id, source_topic_id FROM flashcards WHERE ownerId = ?",
        )
        .all(scope.ownerId) as RemediationCardRow[];
      const plan = planRemediation(card, allCards, {
        nodes: kit.skeleton.graph.nodes,
        edges: kit.skeleton.graph.edges,
      });

      const hasOpenRow = db.prepare(
        "SELECT 1 FROM remediation_queue WHERE ownerId = ? AND card_id = ? AND resolved_at IS NULL",
      );
      const insert = db.prepare(
        `INSERT INTO remediation_queue (ownerId, kit_id, card_id, source_card_id, node_id, node_name, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const item of plan) {
        if (hasOpenRow.get(scope.ownerId, item.cardId)) continue;
        insert.run(
          scope.ownerId,
          kit.id,
          item.cardId,
          card.id,
          item.nodeId,
          item.nodeName,
          item.reason,
        );
        const prereqCard = allCards.find((c) => c.id === item.cardId);
        remediation.push({
          cardId: item.cardId,
          front: prereqCard?.front || "",
          nodeName: item.nodeName,
          reason: item.reason,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("[decks/review] Remediation planning failed:", msg);
    }
  }

  const result = db
    .prepare("SELECT * FROM flashcards WHERE ownerId = ? AND id = ?")
    .get(scope.ownerId, card.id) as FlashcardRow;

  res.json({
    ...result,
    srs_previews: getCardPreviews(result, settings),
    remediation,
  });
}

router.put("/:deckId/cards/:cardId/review", handleReview);
router.post("/:deckId/cards/:cardId/review", handleReview);

router.delete("/:deckId/cards/:cardId", (req, res) => {
  const scope = scopeOf(req);
  if (!getOwnedDeck(scope, req.params.deckId)) {
    res.status(404).json({ message: "Deck not found" });
    return;
  }
  db.prepare(
    "DELETE FROM flashcards WHERE ownerId = ? AND id = ? AND deck_id = ?",
  ).run(scope.ownerId, req.params.cardId, req.params.deckId);
  db.prepare(
    "UPDATE decks SET updated_at = datetime('now') WHERE ownerId = ? AND id = ?",
  ).run(scope.ownerId, req.params.deckId);
  res.status(204).send();
});

export default router;
