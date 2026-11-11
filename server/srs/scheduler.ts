export const FSRS6_DEFAULT_WEIGHTS = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666,
  0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658,
  0.1542,
] as const;

export type FsrsGrade = 1 | 2 | 3 | 4;

export interface DeckSettings {
  new_limit: number;
  review_limit: number;
  steps: string;
  lapse_steps: string;
  easy_bonus: number;
  desired_retention: number;
  learning_steps?: string;
  relearning_steps?: string;
  graduating_interval?: number;
  easy_interval?: number;
  starting_ease?: number;
  interval_modifier?: number;
  hard_interval?: number;
}

export interface SrsCardInput {
  ease_factor?: number | null;
  interval?: number | null;
  repetitions?: number | null;
  state?: number | null;
  learning_step?: number | null;
  stability?: number | null;
  difficulty?: number | null;
  lapses?: number | null;
  last_reviewed?: string | null;
  next_review?: string | null;
}

export interface SrsNextState {
  ease_factor: number;
  interval: number;
  repetitions: number;
  state: number;
  learning_step: number;
  stability: number;
  difficulty: number;
  lapses: number;
  next_review: string;
  last_reviewed: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

export const DEFAULT_DECK_SETTINGS: DeckSettings = {
  new_limit: 20,
  review_limit: 200,
  steps: "1m 10m",
  lapse_steps: "10m",
  easy_bonus: 1.3,
  desired_retention: 0.9,
  learning_steps: "1m 10m",
  relearning_steps: "10m",
  graduating_interval: 1,
  easy_interval: 4,
  starting_ease: 2.5,
  interval_modifier: 1.0,
  hard_interval: 1.2,
};

function clamp(min: number, max: number, value: number): number {
  return Math.min(max, Math.max(min, value));
}

export function parseUtcTimestampMs(raw: string | null | undefined): number {
  if (!raw || typeof raw !== "string") return NaN;
  const trimmed = raw.trim();
  if (!trimmed) return NaN;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed)) {
    return Date.parse(`${trimmed.replace(" ", "T")}Z`);
  }
  return Date.parse(trimmed);
}

function toFiniteOrUndefined(val: unknown): number | undefined {
  if (typeof val === "number") return Number.isFinite(val) ? val : undefined;
  if (typeof val === "string" && val.trim() !== "") {
    const n = Number(val.trim());
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function sanitizeFiniteInt(
  val: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = toFiniteOrUndefined(val);
  if (n === undefined) return fallback;
  return clamp(min, max, Math.trunc(n));
}

function sanitizeFiniteFloat(
  val: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = toFiniteOrUndefined(val);
  if (n === undefined) return fallback;
  return clamp(min, max, n);
}

export function clampDesiredRetention(value: number | undefined | null): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.9;
  return clamp(0.75, 0.97, value);
}

export function parseDeckSettings(
  settingsJson: string | null | undefined,
): DeckSettings {
  let raw: Record<string, unknown> = {};
  if (settingsJson) {
    try {
      const parsed = JSON.parse(settingsJson) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        raw = parsed as Record<string, unknown>;
      }
    } catch {
      // Malformed settings — fall back to defaults
    }
  }
  const stepsRaw =
    typeof raw.steps === "string" && raw.steps.trim()
      ? raw.steps.trim()
      : typeof raw.learning_steps === "string" && raw.learning_steps.trim()
        ? raw.learning_steps.trim()
        : DEFAULT_DECK_SETTINGS.steps;
  const lapseStepsRaw =
    typeof raw.lapse_steps === "string" && raw.lapse_steps.trim()
      ? raw.lapse_steps.trim()
      : typeof raw.relearning_steps === "string" && raw.relearning_steps.trim()
        ? raw.relearning_steps.trim()
        : DEFAULT_DECK_SETTINGS.lapse_steps;

  return {
    ...DEFAULT_DECK_SETTINGS,
    new_limit: sanitizeFiniteInt(
      raw.new_limit,
      DEFAULT_DECK_SETTINGS.new_limit,
      0,
      10_000,
    ),
    review_limit: sanitizeFiniteInt(
      raw.review_limit,
      DEFAULT_DECK_SETTINGS.review_limit,
      0,
      10_000,
    ),
    steps: stepsRaw,
    lapse_steps: lapseStepsRaw,
    learning_steps: stepsRaw,
    relearning_steps: lapseStepsRaw,
    easy_bonus: sanitizeFiniteFloat(
      raw.easy_bonus,
      DEFAULT_DECK_SETTINGS.easy_bonus,
      1.0,
      10.0,
    ),
    desired_retention: clampDesiredRetention(
      toFiniteOrUndefined(raw.desired_retention),
    ),
    graduating_interval: sanitizeFiniteInt(
      raw.graduating_interval,
      DEFAULT_DECK_SETTINGS.graduating_interval!,
      1,
      365,
    ),
    easy_interval: sanitizeFiniteInt(
      raw.easy_interval,
      DEFAULT_DECK_SETTINGS.easy_interval!,
      1,
      365,
    ),
    starting_ease: sanitizeFiniteFloat(
      raw.starting_ease,
      DEFAULT_DECK_SETTINGS.starting_ease!,
      1.3,
      5.0,
    ),
    interval_modifier: sanitizeFiniteFloat(
      raw.interval_modifier,
      DEFAULT_DECK_SETTINGS.interval_modifier!,
      0.1,
      10.0,
    ),
    hard_interval: sanitizeFiniteFloat(
      raw.hard_interval,
      DEFAULT_DECK_SETTINGS.hard_interval!,
      1.0,
      10.0,
    ),
  };
}

export function retrievability(
  elapsedDays: number,
  stability: number,
  w20: number = FSRS6_DEFAULT_WEIGHTS[20],
): number {
  if (!(stability > 0)) return 0;
  const t = Math.max(0, elapsedDays);
  if (t === 0) return 1;
  const factor = Math.pow(0.9, -1 / w20) - 1;
  return Math.pow(1 + (factor * t) / stability, -w20);
}

export function nextIntervalDays(
  stability: number,
  desiredRetention: number = 0.9,
  w20: number = FSRS6_DEFAULT_WEIGHTS[20],
): number {
  const r = clampDesiredRetention(desiredRetention);
  const s = Math.max(0.01, stability);
  const factor = Math.pow(0.9, -1 / w20) - 1;
  const raw = (s / factor) * (Math.pow(r, -1 / w20) - 1);
  return Math.max(1, Math.round(raw));
}

export function initStability(
  grade: FsrsGrade,
  w: readonly number[] = FSRS6_DEFAULT_WEIGHTS,
): number {
  return Math.max(0.01, w[grade - 1]);
}

export function initDifficulty(
  grade: FsrsGrade,
  w: readonly number[] = FSRS6_DEFAULT_WEIGHTS,
): number {
  return clamp(1, 10, w[4] - Math.exp(w[5] * (grade - 1)) + 1);
}

export function nextDifficulty(
  difficulty: number,
  grade: FsrsGrade,
  w: readonly number[] = FSRS6_DEFAULT_WEIGHTS,
): number {
  const deltaD = -w[6] * (grade - 3);
  const damped = difficulty + (deltaD * (10 - difficulty)) / 9;
  const reverted = w[7] * initDifficulty(4, w) + (1 - w[7]) * damped;
  return clamp(1, 10, reverted);
}

export function nextShortTermStability(
  stability: number,
  grade: FsrsGrade,
  w: readonly number[] = FSRS6_DEFAULT_WEIGHTS,
): number {
  const s = Math.max(0.01, stability);
  const sinc = Math.exp(w[17] * (grade - 3 + w[18])) * Math.pow(s, -w[19]);
  const masked = grade >= 3 ? Math.max(1, sinc) : sinc;
  return Math.max(0.01, s * masked);
}

export function nextRecallStability(
  difficulty: number,
  stability: number,
  r: number,
  grade: 2 | 3 | 4,
  w: readonly number[] = FSRS6_DEFAULT_WEIGHTS,
): number {
  const s = Math.max(0.01, stability);
  const d = clamp(1, 10, difficulty);
  const clampedR = clamp(0, 1, r);
  const hardPenalty = grade === 2 ? w[15] : 1;
  const easyBonus = grade === 4 ? w[16] : 1;
  const inc =
    Math.exp(w[8]) *
    (11 - d) *
    Math.pow(s, -w[9]) *
    (Math.exp(w[10] * (1 - clampedR)) - 1) *
    hardPenalty *
    easyBonus;
  return Math.max(0.01, s * (1 + inc));
}

export function nextForgetStability(
  difficulty: number,
  stability: number,
  r: number,
  w: readonly number[] = FSRS6_DEFAULT_WEIGHTS,
): number {
  const s = Math.max(0.01, stability);
  const d = clamp(1, 10, difficulty);
  const clampedR = clamp(0, 1, r);
  const raw =
    w[11] *
    Math.pow(d, -w[12]) *
    (Math.pow(s + 1, w[13]) - 1) *
    Math.exp(w[14] * (1 - clampedR));
  return clamp(0.01, s, raw);
}

export function bootstrapSm2Card(card: SrsCardInput): {
  stability: number;
  difficulty: number;
} {
  const ease =
    card.ease_factor !== undefined && card.ease_factor !== null
      ? card.ease_factor
      : 2.5;
  const stability =
    card.stability !== undefined && card.stability !== null && card.stability > 0
      ? card.stability
      : Math.max(0.5, card.interval || 1);
  const difficulty =
    card.difficulty !== undefined &&
    card.difficulty !== null &&
    card.difficulty > 0
      ? clamp(1, 10, card.difficulty)
      : clamp(1, 10, 11 - 2.5 * ease);
  return { stability, difficulty };
}

export function easeFromDifficulty(difficulty: number): number {
  const raw = clamp(1.3, 3.5, (11 - clamp(1, 10, difficulty)) / 2.5);
  return Math.round(raw * 100) / 100;
}

export function qualityToFsrsGrade(
  quality: number,
  confidence?: string | null,
): FsrsGrade {
  if (!Number.isFinite(quality)) return 1;
  // "low" is what the web app and the MCP tool send for a guess.
  const guessed = confidence === "guessed" || confidence === "low";
  const effective = guessed && quality > 3 ? 3 : quality;
  if (effective < 3) return 1;
  if (effective === 3) return 2;
  if (effective === 4) return 3;
  return 4;
}

function parseStepsMinutes(raw: string | undefined, fallback: number[]): number[] {
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  const parsed = raw
    .trim()
    .split(/\s+/)
    .map((token) => {
      const val = parseFloat(token);
      if (!Number.isFinite(val) || val <= 0) return NaN;
      if (token.endsWith("d")) return Math.round(val * 24 * 60);
      if (token.endsWith("h")) return Math.round(val * 60);
      return Math.max(1, Math.round(val));
    })
    .filter((n) => Number.isFinite(n) && n > 0);
  return parsed.length > 0 ? parsed : fallback;
}

function deriveReviewElapsedDays(
  card: SrsCardInput,
  fallbackStability: number,
  nowMs: number,
): number {
  if (card.last_reviewed) {
    const lastMs = parseUtcTimestampMs(card.last_reviewed);
    if (Number.isFinite(lastMs)) {
      return Math.max(0, (nowMs - lastMs) / DAY_MS);
    }
  }
  if (card.next_review) {
    const nextMs = parseUtcTimestampMs(card.next_review);
    if (Number.isFinite(nextMs)) {
      const daysUntilDue = (nextMs - nowMs) / DAY_MS;
      return Math.max(0.5, (card.interval || fallbackStability) - daysUntilDue);
    }
  }
  return Math.max(0.5, card.interval || fallbackStability);
}

export function calculateNextSrsState(
  card: SrsCardInput,
  quality: number,
  settings?: Partial<DeckSettings> | null,
  confidence: string | null = "medium",
  now: Date = new Date(),
): SrsNextState {
  const state = card.state || 0;
  const learningStep = card.learning_step || 0;
  const prevReps = card.repetitions || 0;
  const prevLapses = card.lapses || 0;

  const desiredRetention = clampDesiredRetention(settings?.desired_retention);
  const intervalModifier =
    typeof settings?.interval_modifier === "number" &&
    Number.isFinite(settings.interval_modifier) &&
    settings.interval_modifier > 0
      ? clamp(0.1, 10.0, settings.interval_modifier)
      : 1.0;

  const stepsMins = parseStepsMinutes(
    settings?.steps ?? settings?.learning_steps,
    [1, 10],
  );
  const lapseStepsMins = parseStepsMinutes(
    settings?.lapse_steps ?? settings?.relearning_steps,
    [10],
  );

  const grade = qualityToFsrsGrade(quality, confidence);
  const nowMs = now.getTime();

  const scaleInterval = (days: number): number =>
    Math.max(1, Math.round(days * intervalModifier));

  let nextState = state;
  let nextLearningStep = learningStep;
  let nextInterval = card.interval || 0;
  let nextRepetitions = prevReps;
  let nextLapses = prevLapses;
  let nextStability: number;
  let nextDiff: number;
  let nextReviewMs: number;

  if (state === 0) {
    nextStability = initStability(grade);
    nextDiff = initDifficulty(grade);

    if (grade === 1) {
      nextState = 1;
      nextLearningStep = 0;
      nextInterval = 0;
      nextRepetitions = 0;
      const againMins =
        confidence === "high"
          ? Math.max(1, Math.round(stepsMins[0] / 2))
          : stepsMins[0];
      nextReviewMs = nowMs + againMins * MIN_MS;
    } else if (grade === 2) {
      nextState = 1;
      nextLearningStep = 0;
      nextInterval = 0;
      nextRepetitions = 0;
      const hardMins =
        stepsMins.length > 1
          ? Math.max(
              stepsMins[0] + 1,
              Math.round((stepsMins[0] + stepsMins[1]) / 2),
            )
          : Math.max(stepsMins[0] + 1, Math.round(stepsMins[0] * 1.5));
      nextReviewMs = nowMs + hardMins * MIN_MS;
    } else if (grade === 3) {
      if (stepsMins.length > 1) {
        nextState = 1;
        nextLearningStep = 1;
        nextInterval = 0;
        nextRepetitions = 0;
        const hardMins = Math.max(
          stepsMins[0] + 1,
          Math.round((stepsMins[0] + stepsMins[1]) / 2),
        );
        const goodMins = Math.max(hardMins + 1, stepsMins[1]);
        nextReviewMs = nowMs + goodMins * MIN_MS;
      } else {
        nextState = 2;
        nextLearningStep = 0;
        nextInterval = scaleInterval(
          nextIntervalDays(nextStability, desiredRetention),
        );
        nextRepetitions = 1;
        nextReviewMs = nowMs + nextInterval * DAY_MS;
      }
    } else {
      nextState = 2;
      nextLearningStep = 0;
      const goodFloor =
        stepsMins.length <= 1
          ? scaleInterval(nextIntervalDays(initStability(3), desiredRetention))
          : 1;
      nextInterval = Math.max(
        goodFloor + 1,
        scaleInterval(nextIntervalDays(nextStability, desiredRetention)),
      );
      nextRepetitions = 1;
      nextReviewMs = nowMs + nextInterval * DAY_MS;
    }
  } else if (state === 1 || state === 3) {
    const isInitial = state === 1;
    const steps = isInitial ? stepsMins : lapseStepsMins;
    const { stability: bootS, difficulty: bootD } = bootstrapSm2Card(card);
    const prevS = isInitial
      ? card.stability && card.stability > 0
        ? card.stability
        : initStability(3)
      : bootS;
    const prevD = isInitial
      ? card.difficulty && card.difficulty > 0
        ? clamp(1, 10, card.difficulty)
        : initDifficulty(3)
      : bootD;

    nextDiff = nextDifficulty(prevD, grade);
    nextStability = nextShortTermStability(prevS, grade);
    const idx = Math.min(Math.max(0, learningStep), steps.length - 1);
    const stayState = isInitial ? 1 : 3;

    if (grade === 1) {
      nextState = stayState;
      nextLearningStep = 0;
      nextInterval = 0;
      nextReviewMs = nowMs + steps[0] * MIN_MS;
    } else if (grade === 2) {
      nextState = stayState;
      nextLearningStep = idx;
      nextInterval = 0;
      const hardMins =
        idx < steps.length - 1
          ? Math.max(
              steps[0] + 1,
              Math.round((steps[idx] + steps[idx + 1]) / 2),
            )
          : Math.max(steps[0] + 1, Math.round(steps[idx] * 1.5));
      nextReviewMs = nowMs + hardMins * MIN_MS;
    } else if (grade === 3 && idx < steps.length - 1) {
      nextState = stayState;
      nextLearningStep = idx + 1;
      nextInterval = 0;
      const hardMins = Math.max(
        steps[0] + 1,
        Math.round((steps[idx] + steps[idx + 1]) / 2),
      );
      nextReviewMs = nowMs + Math.max(hardMins + 1, steps[idx + 1]) * MIN_MS;
    } else if (grade === 3) {
      nextState = 2;
      nextLearningStep = 0;
      nextInterval = scaleInterval(
        nextIntervalDays(nextStability, desiredRetention),
      );
      nextRepetitions = Math.max(1, prevReps + 1);
      nextReviewMs = nowMs + nextInterval * DAY_MS;
    } else {
      nextState = 2;
      nextLearningStep = 0;
      if (isInitial) nextStability = Math.max(initStability(4), nextStability);
      const goodGradFloor = scaleInterval(
        nextIntervalDays(nextShortTermStability(prevS, 3), desiredRetention),
      );
      nextInterval = Math.max(
        goodGradFloor + 1,
        scaleInterval(nextIntervalDays(nextStability, desiredRetention)),
      );
      nextRepetitions = Math.max(1, prevReps + 1);
      nextReviewMs = nowMs + nextInterval * DAY_MS;
    }
  } else {
    // state === 2 (Review)
    const { stability: prevS, difficulty: prevD } = bootstrapSm2Card(card);
    const elapsedDays = deriveReviewElapsedDays(card, prevS, nowMs);
    const r = retrievability(elapsedDays, prevS);
    nextDiff = nextDifficulty(prevD, grade);

    if (grade === 1) {
      nextState = 3;
      nextLearningStep = 0;
      nextInterval = 0;
      nextRepetitions = 0;
      nextLapses = prevLapses + 1;
      nextStability = nextForgetStability(prevD, prevS, r);
      const againMins =
        confidence === "high"
          ? Math.max(1, Math.round(lapseStepsMins[0] / 2))
          : lapseStepsMins[0];
      nextReviewMs = nowMs + againMins * MIN_MS;
    } else {
      const recallFor = (g: 2 | 3 | 4): number =>
        elapsedDays >= 1
          ? nextRecallStability(prevD, prevS, r, g)
          : nextShortTermStability(prevS, g);

      const sHard = recallFor(2);
      const sGood = recallFor(3);
      const sEasy = recallFor(4);

      const hardInt = scaleInterval(nextIntervalDays(sHard, desiredRetention));
      const goodInt = Math.max(
        hardInt + 1,
        scaleInterval(nextIntervalDays(sGood, desiredRetention)),
      );
      const easyInt = Math.max(
        goodInt + 1,
        scaleInterval(nextIntervalDays(sEasy, desiredRetention)),
      );

      nextState = 2;
      nextLearningStep = 0;
      nextRepetitions = prevReps + 1;
      [nextStability, nextInterval] =
        grade === 2
          ? [sHard, hardInt]
          : grade === 3
            ? [sGood, goodInt]
            : [sEasy, easyInt];
      nextReviewMs = nowMs + nextInterval * DAY_MS;
    }
  }

  const roundedStability = Math.round(nextStability * 10000) / 10000;
  const roundedDifficulty = Math.round(nextDiff * 10000) / 10000;

  return {
    ease_factor: easeFromDifficulty(roundedDifficulty),
    interval: nextInterval,
    repetitions: nextRepetitions,
    state: nextState,
    learning_step: nextLearningStep,
    stability: roundedStability,
    difficulty: roundedDifficulty,
    lapses: nextLapses,
    next_review: new Date(nextReviewMs).toISOString(),
    last_reviewed: now.toISOString(),
  };
}

export function getCardPreviews(
  card: SrsCardInput,
  settings?: Partial<DeckSettings> | null,
  now: Date = new Date(),
): { again: string; hard: string; good: string; easy: string } {
  const preview = (quality: number): string => {
    const s = calculateNextSrsState(card, quality, settings, "medium", now);
    if (s.state === 1 || s.state === 3) {
      const diffMins = Math.max(
        1,
        Math.round((new Date(s.next_review).getTime() - now.getTime()) / MIN_MS),
      );
      if (diffMins < 60) return `${diffMins}m`;
      const diffHours = Math.round(diffMins / 60);
      return diffHours < 24 ? `${diffHours}h` : `${Math.round(diffHours / 24)}d`;
    }
    if (s.interval < 30) return `${s.interval}d`;
    return s.interval < 365
      ? `${Math.round(s.interval / 30)}mo`
      : `${Math.round(s.interval / 365)}y`;
  };

  return {
    again: preview(1),
    hard: preview(3),
    good: preview(4),
    easy: preview(5),
  };
}

export function formatRelativeTime(dateStr: string | null | undefined): string {
  const dateMs = parseUtcTimestampMs(dateStr);
  if (!Number.isFinite(dateMs)) return "Never studied";
  const diffMs = Date.now() - dateMs;
  const diffDays = Math.floor(diffMs / DAY_MS);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return `${diffDays} days ago`;
}
