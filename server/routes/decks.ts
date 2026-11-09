import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import db from "../db.ts";
import {
  asyncHandler,
  getErrorMessage,
  NotFoundError,
} from "../platform/net/errors.ts";
import { scopeOf, type Scope } from "../platform/tenancy/scope.ts";
import { resolveActiveKit, resolveKitById } from "../kits/kitContext.ts";
import {
  deleteRagChunksBySource,
  deleteRagChunksForDeck,
  upsertRagChunk,
} from "../search/hybridSearch.ts";
import {
  calculateNextSrsState,
  clampDesiredRetention,
  getCardPreviews,
  formatRelativeTime,
  parseDeckSettings,
  type DeckSettings,
} from "../srs/scheduler.ts";
import { nodesForCard } from "../../shared/kits/kitSkeleton.ts";
import { applyImplicitPrerequisiteCredit } from "../graph/encompassing.ts";
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
  stability: number | null;
  difficulty: number | null;
  lapses: number;
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

function getOwnedCard(scope: Scope, cardId: string): FlashcardRow | undefined {
  return db
    .prepare("SELECT * FROM flashcards WHERE ownerId = ? AND id = ?")
    .get(scope.ownerId, cardId) as FlashcardRow | undefined;
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
  const rows = db
    .prepare(
      `SELECT f.*, r.reason AS remediation_reason, r.node_name AS remediation_node
       FROM remediation_queue r
       JOIN flashcards f ON f.ownerId = r.ownerId AND f.id = r.card_id
       WHERE r.ownerId = ? AND r.resolved_at IS NULL ${deckId ? "AND f.deck_id = ?" : ""}
       ORDER BY r.created_at ASC
       LIMIT 10`,
    )
    .all(...(deckId ? [scope.ownerId, deckId] : [scope.ownerId])) as FlashcardRow[];

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
  const kit = resolveActiveKit(req, db, scope);

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
    return {
      ...deck,
      new_count: row.new_count || 0,
      learn_count: row.learn_count || 0,
      due_count: row.due_count || 0,
      settings: parseDeckSettings(row.settings),
      progress,
      last_studied: formatRelativeTime(last_reviewed_raw),
    };
  });

  res.json(decks);
});

function readOptionalKitSelector(req: Request): string | null {
  const fromQuery =
    typeof req.query.kitId === "string"
      ? req.query.kitId.trim()
      : typeof req.query.kit === "string"
        ? req.query.kit.trim()
        : "";
  const fromHeader =
    typeof req.headers["x-toolbox-kit"] === "string"
      ? req.headers["x-toolbox-kit"].trim()
      : "";
  const raw = fromQuery || fromHeader;
  return !raw || raw === "all" || raw === "*" ? null : raw;
}

function resolveOptionalKitId(
  scope: Scope,
  kitSelector: string | null | undefined,
): string | null {
  const trimmed = kitSelector?.trim() ?? "";
  if (!trimmed || trimmed === "all" || trimmed === "*") return null;
  const resolved = resolveKitById(db, scope, trimmed);
  if (!resolved) {
    throw new NotFoundError("Kit", trimmed);
  }
  return resolved.id;
}

interface JoinedDeckRow {
  id: string;
  name: string;
  settings: string;
  kit_id: string;
  kit_slug: string;
  kit_name: string;
  kit_icon: string;
  kit_color: string;
}

export function collectDueReviewQueue(
  scope: Scope,
  opts: { kitSelector?: string | null } = {},
): Array<FlashcardRow & Record<string, unknown>> {
  const resolvedKitId = resolveOptionalKitId(scope, opts.kitSelector);
  const kitParams = resolvedKitId ? [scope.ownerId, resolvedKitId] : [scope.ownerId];

  const allDecks = db
    .prepare(
      `SELECT d.id, d.name, d.settings, d.kit_id,
              k.slug AS kit_slug, k.name AS kit_name, k.icon AS kit_icon, k.color AS kit_color
       FROM decks d
       JOIN kits k ON k.ownerId = d.ownerId AND k.id = d.kit_id
       WHERE d.ownerId = ? ${resolvedKitId ? "AND d.kit_id = ?" : ""}`,
    )
    .all(...kitParams) as JoinedDeckRow[];

  if (allDecks.length === 0) return [];

  const todayCounts = db
    .prepare(
      `SELECT f.deck_id,
              COALESCE(SUM(CASE WHEN f.repetitions = 1 THEN 1 ELSE 0 END), 0) AS new_today,
              COALESCE(SUM(CASE WHEN f.repetitions > 1 THEN 1 ELSE 0 END), 0) AS rev_today
       FROM flashcards f
       JOIN decks d ON d.ownerId = f.ownerId AND d.id = f.deck_id
       WHERE f.ownerId = ? ${resolvedKitId ? "AND d.kit_id = ?" : ""}
         AND f.last_reviewed IS NOT NULL
         AND date(f.last_reviewed, 'localtime') = date('now', 'localtime')
       GROUP BY f.deck_id`,
    )
    .all(...kitParams) as Array<{
    deck_id: string;
    new_today: number;
    rev_today: number;
  }>;

  const countsByDeck = new Map<string, { newToday: number; revToday: number }>();
  for (const row of todayCounts) {
    countsByDeck.set(row.deck_id, {
      newToday: row.new_today || 0,
      revToday: row.rev_today || 0,
    });
  }

  const candidateCards = db
    .prepare(
      `SELECT * FROM flashcards
       WHERE ownerId = ?
         ${resolvedKitId ? "AND deck_id IN (SELECT id FROM decks WHERE ownerId = ? AND kit_id = ?)" : ""}
         AND (
           (state IN (1, 3) AND (next_review IS NULL OR next_review <= datetime('now')))
           OR (state = 2 AND (next_review IS NULL OR next_review <= datetime('now')))
           OR ((state = 0 OR state IS NULL) AND next_review IS NULL)
         )
         AND ${PREREQ_UNLOCKED_SQL}`,
    )
    .all(
      ...(resolvedKitId
        ? [scope.ownerId, scope.ownerId, resolvedKitId]
        : [scope.ownerId]),
    ) as FlashcardRow[];

  const cardsByDeck = new Map<string, FlashcardRow[]>();
  for (const card of candidateCards) {
    const bucket = cardsByDeck.get(card.deck_id);
    if (bucket) bucket.push(card);
    else cardsByDeck.set(card.deck_id, [card]);
  }

  const deckMeta = new Map<string, JoinedDeckRow>(
    allDecks.map((d) => [d.id, d]),
  );
  const deckSettings = new Map<string, DeckSettings>(
    allDecks.map((d) => [d.id, parseDeckSettings(d.settings)]),
  );

  const allDueCards: Array<FlashcardRow & Record<string, unknown>> = [];
  const byNextReviewAsc = (a: FlashcardRow, b: FlashcardRow) =>
    (a.next_review ?? "").localeCompare(b.next_review ?? "");
  const byPositionAsc = (a: FlashcardRow, b: FlashcardRow) =>
    (a.position ?? 0) - (b.position ?? 0) || a.id.localeCompare(b.id);

  for (const deck of allDecks) {
    const deckId = deck.id;
    const settings = deckSettings.get(deckId)!;
    const counts = countsByDeck.get(deckId) ?? { newToday: 0, revToday: 0 };
    const bucket = cardsByDeck.get(deckId) ?? [];

    const learningCards = bucket
      .filter((c) => c.state === 1 || c.state === 3)
      .sort(byNextReviewAsc);

    const remainingReviews = Math.max(0, settings.review_limit - counts.revToday);
    const reviewCards =
      remainingReviews > 0
        ? bucket
            .filter((c) => c.state === 2)
            .sort(byNextReviewAsc)
            .slice(0, remainingReviews)
        : [];

    const remainingNew = Math.max(0, settings.new_limit - counts.newToday);
    const newCards =
      remainingNew > 0
        ? bucket
            .filter((c) => (c.state || 0) === 0)
            .sort(byPositionAsc)
            .slice(0, remainingNew)
        : [];

    for (const c of [...learningCards, ...reviewCards, ...newCards]) {
      allDueCards.push({
        ...c,
        deckName: deck.name,
        kit_id: deck.kit_id,
        kit_slug: deck.kit_slug,
        kit_name: deck.kit_name,
        kit_icon: deck.kit_icon,
        kit_color: deck.kit_color,
        srs_previews: getCardPreviews(c, settings),
      });
    }
  }

  for (let i = allDueCards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allDueCards[i], allDueCards[j]] = [allDueCards[j], allDueCards[i]];
  }

  return applyRemediation(scope, allDueCards, null)
    .filter((c) => deckMeta.has(c.deck_id))
    .map((c) => {
      const meta = deckMeta.get(c.deck_id)!;
      return {
        ...c,
        deckName: (c.deckName as string | undefined) ?? meta.name,
        kit_id: meta.kit_id,
        kit_slug: meta.kit_slug,
        kit_name: meta.kit_name,
        kit_icon: meta.kit_icon,
        kit_color: meta.kit_color,
        srs_previews:
          c.srs_previews ??
          getCardPreviews(
            c,
            deckSettings.get(c.deck_id) || parseDeckSettings(null),
          ),
      };
    });
}

router.get(["/all/cards/due", "/interleaved/due"], (req, res) => {
  const scope = scopeOf(req);
  res.json(collectDueReviewQueue(scope, { kitSelector: readOptionalKitSelector(req) }));
});

router.get("/stats", (req, res) => {
  const scope = scopeOf(req);
  const resolvedKitId = resolveOptionalKitId(scope, readOptionalKitSelector(req));

  const row = db
    .prepare(
      `SELECT
         COUNT(DISTINCT d.id) AS deckCount,
         COUNT(f.id) AS cardCount,
         COALESCE(SUM(CASE
           WHEN f.id IS NOT NULL AND f.state IN (1, 2, 3)
             AND (f.next_review IS NULL OR datetime(f.next_review) <= datetime('now'))
           THEN 1 ELSE 0 END), 0) AS dueCount,
         COALESCE(SUM(CASE
           WHEN f.id IS NOT NULL AND (f.state = 0 OR f.state IS NULL)
           THEN 1 ELSE 0 END), 0) AS newCount,
         COALESCE(SUM(CASE
           WHEN f.id IS NOT NULL AND f.state IN (1, 3)
           THEN 1 ELSE 0 END), 0) AS learningCount,
         COALESCE(SUM(CASE
           WHEN f.id IS NOT NULL AND f.state = 2
           THEN 1 ELSE 0 END), 0) AS reviewCount,
         COALESCE(SUM(CASE
           WHEN f.id IS NOT NULL AND f.state = 2 AND COALESCE(f.interval, 0) >= 21
           THEN 1 ELSE 0 END), 0) AS masteredCount,
         COALESCE(SUM(CASE
           WHEN f.id IS NOT NULL AND f.last_reviewed IS NOT NULL
             AND date(f.last_reviewed, 'localtime') = date('now', 'localtime')
           THEN 1 ELSE 0 END), 0) AS reviewedTodayCount
       FROM decks d
       LEFT JOIN flashcards f ON f.ownerId = d.ownerId AND f.deck_id = d.id
       WHERE d.ownerId = ? ${resolvedKitId ? "AND d.kit_id = ?" : ""}`,
    )
    .get(
      ...(resolvedKitId ? [scope.ownerId, resolvedKitId] : [scope.ownerId]),
    ) as {
    deckCount: number;
    cardCount: number;
    dueCount: number;
    newCount: number;
    learningCount: number;
    reviewCount: number;
    masteredCount: number;
    reviewedTodayCount: number;
  };

  res.json({
    kitId: resolvedKitId,
    deckCount: row.deckCount || 0,
    cardCount: row.cardCount || 0,
    totalCards: row.cardCount || 0,
    dueCount: row.dueCount || 0,
    newCount: row.newCount || 0,
    learningCount: row.learningCount || 0,
    learnCount: row.learningCount || 0,
    reviewCount: row.reviewCount || 0,
    masteredCount: row.masteredCount || 0,
    reviewedTodayCount: row.reviewedTodayCount || 0,
  });
});

function handleCardOnlyReview(req: Request, res: Response): void {
  const scope = scopeOf(req);
  const card = getOwnedCard(scope, String(req.params.cardId));
  if (!card) {
    res.status(404).json({ message: "Card not found" });
    return;
  }
  (req.params as Record<string, string>).deckId = card.deck_id;
  handleReview(req, res);
}

router.post("/cards/:cardId/review", handleCardOnlyReview);
router.put("/cards/:cardId/review", handleCardOnlyReview);

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
  const kit = resolveActiveKit(req, db, scope);
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

  const id = randomUUID();
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

  res.status(201).json(getOwnedDeck(scope, id));
});

router.put("/:id", (req, res) => {
  const scope = scopeOf(req);
  const { name, description, color_index, tags } = req.body as {
    name?: string;
    description?: string;
    color_index?: number;
    tags?: string;
  };
  if (!getOwnedDeck(scope, req.params.id)) {
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
  const {
    new_limit,
    review_limit,
    steps,
    lapse_steps,
    easy_bonus,
    desired_retention,
  } = req.body as {
    new_limit?: number | string;
    review_limit?: number | string;
    steps?: string;
    lapse_steps?: string;
    easy_bonus?: number | string;
    desired_retention?: number | string;
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
    desired_retention:
      desired_retention !== undefined
        ? clampDesiredRetention(parseFloat(String(desired_retention)))
        : currentSettings.desired_retention,
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

  deleteRagChunksForDeck(db, scope, existing.kit_id, req.params.id);
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

  const todayRow = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN repetitions = 1 THEN 1 ELSE 0 END), 0) AS newToday,
         COALESCE(SUM(CASE WHEN repetitions > 1 THEN 1 ELSE 0 END), 0) AS reviewsToday
       FROM flashcards
       WHERE ownerId = ? AND deck_id = ?
         AND last_reviewed IS NOT NULL
         AND date(last_reviewed, 'localtime') = date('now', 'localtime')`,
    )
    .get(scope.ownerId, deckId) as { newToday: number; reviewsToday: number };

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

  const remainingReviews = Math.max(
    0,
    settings.review_limit - (todayRow.reviewsToday || 0),
  );
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

  const remainingNew = Math.max(0, settings.new_limit - (todayRow.newToday || 0));
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

  res.json(
    combined.map((c) => ({
      ...c,
      deckName: deck.name,
      srs_previews: getCardPreviews(c, settings),
    })),
  );
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
      const maxSim = Math.max(
        jaccard(incomingFrontTri, existing.frontTri),
        jaccard(incomingCombinedTri, existing.combinedTri),
      );
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
  kitId: string,
  prereqId: unknown,
  selfId?: string,
): string | null {
  if (typeof prereqId !== "string" || !prereqId.trim()) return null;
  const candidate = prereqId.trim();
  if (selfId && candidate === selfId) return null;
  const exists = db
    .prepare(
      `SELECT 1 FROM flashcards f
       JOIN decks d ON d.ownerId = f.ownerId AND d.id = f.deck_id
       WHERE f.ownerId = ? AND f.id = ? AND d.kit_id = ?`,
    )
    .get(scope.ownerId, candidate, kitId);
  return exists ? candidate : null;
}

router.post(
  "/:deckId/cards",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const deckId = String(req.params.deckId);
    const deck = getOwnedDeck(scope, deckId);
    if (!deck) {
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

    const id = randomUUID();
    const maxPos = db
      .prepare(
        "SELECT MAX(position) as max FROM flashcards WHERE ownerId = ? AND deck_id = ?",
      )
      .get(scope.ownerId, deckId) as { max: number | null } | undefined;

    const validPrereq = resolveValidPrereqId(
      scope,
      deck.kit_id,
      prerequisite_id,
      id,
    );
    const nodeId = (node_id as string | undefined) || null;
    const frontText = String(front);
    const backText = String(back);

    db.prepare(
      `INSERT INTO flashcards (
         id, ownerId, deck_id, node_id, front, back, position,
         prerequisite_id, source_pillar_id, source_topic_id, source_section_id,
         is_reverse, reverse_of_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      scope.ownerId,
      deckId,
      nodeId,
      frontText,
      backText,
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
    ).run(scope.ownerId, deckId);

    await upsertRagChunk(db, scope, {
      kitId: deck.kit_id,
      kind: "flashcard",
      sourceRefId: id,
      nodeId,
      title: frontText,
      content: `${frontText}\n${backText}`,
    });

    res.status(201).json(getOwnedCard(scope, id));
  }),
);

router.put(
  "/:deckId/cards/:cardId",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const deckId = String(req.params.deckId);
    const cardId = String(req.params.cardId);
    const deck = getOwnedDeck(scope, deckId);
    if (!deck) {
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
      .get(scope.ownerId, cardId, deckId) as
      | { prerequisite_id: string | null }
      | undefined;
    if (!current) {
      res.status(404).json({ message: "Card not found" });
      return;
    }

    const newPrereq =
      prerequisite_id !== undefined
        ? resolveValidPrereqId(scope, deck.kit_id, prerequisite_id, cardId)
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
      cardId,
      deckId,
    );

    const card = getOwnedCard(scope, cardId)!;

    await upsertRagChunk(db, scope, {
      kitId: deck.kit_id,
      kind: "flashcard",
      sourceRefId: card.id,
      nodeId: card.node_id,
      title: card.front,
      content: `${card.front}\n${card.back}`,
    });

    res.json(card);
  }),
);

function handleReview(req: Request, res: Response): void {
  const scope = scopeOf(req);
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
  const kit = resolveKitById(db, scope, deck.kit_id) ?? resolveActiveKit(req, db, scope);

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
       stability = ?,
       difficulty = ?,
       lapses = ?,
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
    updated.stability,
    updated.difficulty,
    updated.lapses,
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

  let implicitCreditCount = 0;
  if (quality >= 4 && (card.state === 2 || updated.state === 2)) {
    try {
      const matchedNodes = nodesForCard(card, kit.skeleton.graph.nodes);
      const creditedIds = new Set<string>();
      for (const nodeId of matchedNodes) {
        const credit = applyImplicitPrerequisiteCredit(db, scope, kit, {
          nodeId,
          excludeCardId: card.id,
        });
        for (const id of credit.updatedCardIds) creditedIds.add(id);
      }
      implicitCreditCount = creditedIds.size;
    } catch (err) {
      logger.error(
        "[decks/review] Implicit credit propagation failed:",
        getErrorMessage(err),
      );
    }
  }

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
          `SELECT f.id, f.node_id, f.front, f.back, f.state, f.ease_factor, f.interval,
                  f.next_review, f.prerequisite_id, f.source_topic_id
           FROM flashcards f
           JOIN decks d ON d.ownerId = f.ownerId AND d.id = f.deck_id
           WHERE f.ownerId = ? AND d.kit_id = ?`,
        )
        .all(scope.ownerId, kit.id) as RemediationCardRow[];
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
      logger.error(
        "[decks/review] Remediation planning failed:",
        getErrorMessage(err),
      );
    }
  }

  const result = getOwnedCard(scope, card.id)!;

  res.json({
    ...result,
    srs_previews: getCardPreviews(result, settings),
    remediation,
    implicit_credit_count: implicitCreditCount,
  });
}

router.put("/:deckId/cards/:cardId/review", handleReview);
router.post("/:deckId/cards/:cardId/review", handleReview);

router.delete("/:deckId/cards/:cardId", (req, res) => {
  const scope = scopeOf(req);
  const deck = getOwnedDeck(scope, req.params.deckId);
  if (!deck) {
    res.status(404).json({ message: "Deck not found" });
    return;
  }
  const info = db
    .prepare("DELETE FROM flashcards WHERE ownerId = ? AND id = ? AND deck_id = ?")
    .run(scope.ownerId, req.params.cardId, req.params.deckId);
  if (info.changes > 0) {
    deleteRagChunksBySource(db, scope, deck.kit_id, "flashcard", req.params.cardId);
    db.prepare(
      "UPDATE decks SET updated_at = datetime('now') WHERE ownerId = ? AND id = ?",
    ).run(scope.ownerId, req.params.deckId);
  }
  res.status(204).send();
});

export default router;
