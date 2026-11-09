export interface DeckSettings {
  new_limit: number;
  review_limit: number;
  steps: string;
  lapse_steps: string;
  easy_bonus: number;
}

export interface SrsCardInput {
  ease_factor?: number | null;
  interval?: number | null;
  repetitions?: number | null;
  state?: number | null;
  learning_step?: number | null;
}

export interface SrsNextState {
  ease_factor: number;
  interval: number;
  repetitions: number;
  state: number;
  learning_step: number;
  next_review: string;
  last_reviewed: string;
}

export const DEFAULT_DECK_SETTINGS: DeckSettings = {
  new_limit: 20,
  review_limit: 200,
  steps: "1m 10m",
  lapse_steps: "10m",
  easy_bonus: 1.3,
};

export function parseDeckSettings(
  settingsJson: string | null | undefined,
): DeckSettings {
  let settings: DeckSettings = { ...DEFAULT_DECK_SETTINGS };
  if (settingsJson) {
    try {
      settings = { ...settings, ...(JSON.parse(settingsJson) as Partial<DeckSettings>) };
    } catch {
      // Malformed settings — fall back to defaults
    }
  }
  return settings;
}

export function calculateNextSrsState(
  card: SrsCardInput,
  quality: number,
  settings?: Partial<DeckSettings> | null,
  confidence: string = "medium",
): SrsNextState {
  const ease_factor =
    card.ease_factor !== undefined && card.ease_factor !== null
      ? card.ease_factor
      : 2.5;
  const interval = card.interval || 0;
  const state = card.state || 0;
  const learningStep = card.learning_step || 0;

  const steps = settings?.steps
    ? settings.steps.split(" ").map((s) => {
        const val = parseInt(s, 10) || 1;
        const unit: "h" | "m" = s.endsWith("h") ? "h" : "m";
        return { val, unit };
      })
    : [
        { val: 1, unit: "m" as const },
        { val: 10, unit: "m" as const },
      ];

  const lapseSteps = settings?.lapse_steps
    ? settings.lapse_steps.split(" ").map((s) => {
        const val = parseInt(s, 10) || 10;
        const unit: "h" | "m" = s.endsWith("h") ? "h" : "m";
        return { val, unit };
      })
    : [{ val: 10, unit: "m" as const }];

  const easyBonus = settings?.easy_bonus || 1.3;

  let nextState = state;
  let nextLearningStep = learningStep;
  let nextInterval = interval;
  let nextRepetitions = card.repetitions || 0;
  let nextEase = ease_factor;

  const now = new Date();
  let nextReviewDate = new Date();

  const addTime = (date: Date, val: number, unit: "h" | "m"): Date => {
    if (unit === "h") {
      return new Date(date.getTime() + val * 60 * 60 * 1000);
    }
    return new Date(date.getTime() + val * 60 * 1000);
  };

  if (state === 0) {
    if (quality < 3) {
      nextState = 1;
      nextLearningStep = 0;
      nextReviewDate = addTime(now, lapseSteps[0].val, lapseSteps[0].unit);
      nextInterval = 0;

      if (confidence === "high") {
        nextEase = Math.max(1.3, nextEase - 0.4);
        nextReviewDate = addTime(
          now,
          Math.max(1, lapseSteps[0].val / 2),
          lapseSteps[0].unit,
        );
      } else {
        nextEase = Math.max(1.3, nextEase - 0.2);
      }
      nextRepetitions = 0;
    } else if (quality === 3) {
      nextState = 1;
      nextLearningStep = 0;
      const firstVal = steps[0].val * (steps[0].unit === "h" ? 60 : 1);
      const second = steps[1] || steps[0];
      const secondVal = second.val * (second.unit === "h" ? 60 : 1);
      const stepVal = Math.round((firstVal + secondVal) / 2);
      nextReviewDate = addTime(now, stepVal, "m");
      nextInterval = 0;
      nextRepetitions = 0;
    } else if (quality === 4) {
      nextState = 1;
      if (steps.length > 1) {
        nextLearningStep = 1;
        nextReviewDate = addTime(now, steps[1].val, steps[1].unit);
        nextRepetitions = 0;
      } else {
        nextState = 2;
        nextLearningStep = 0;
        nextInterval = 1;
        nextReviewDate = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
        nextRepetitions = 1;
      }
    } else {
      nextState = 2;
      nextLearningStep = 0;
      nextInterval = 4;
      nextReviewDate = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);
      nextRepetitions = 1;
    }
  } else if (state === 1) {
    const activeStep = steps[Math.min(nextLearningStep, steps.length - 1)];
    if (quality < 3) {
      nextLearningStep = 0;
      nextReviewDate = addTime(now, steps[0].val, steps[0].unit);
      nextInterval = 0;
    } else if (quality === 3) {
      const currentVal = activeStep.val * (activeStep.unit === "h" ? 60 : 1);
      const stepVal = Math.round(currentVal * 1.5);
      nextReviewDate = addTime(now, stepVal, "m");
      nextInterval = 0;
    } else if (quality === 4) {
      if (nextLearningStep < steps.length - 1) {
        nextLearningStep += 1;
        nextReviewDate = addTime(
          now,
          steps[nextLearningStep].val,
          steps[nextLearningStep].unit,
        );
        nextInterval = 0;
      } else {
        nextState = 2;
        nextLearningStep = 0;
        nextInterval = 1;
        nextReviewDate = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
        nextRepetitions = 1;
      }
    } else {
      nextState = 2;
      nextLearningStep = 0;
      nextInterval = 4;
      nextReviewDate = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);
      nextRepetitions = 1;
    }
  } else if (state === 2) {
    if (quality < 3) {
      nextState = 3;
      nextLearningStep = 0;

      if (confidence === "high") {
        nextEase = Math.max(1.3, ease_factor - 0.4);
        nextReviewDate = addTime(
          now,
          Math.max(1, lapseSteps[0].val / 2),
          lapseSteps[0].unit,
        );
      } else {
        nextEase = Math.max(1.3, ease_factor - 0.2);
        nextReviewDate = addTime(now, lapseSteps[0].val, lapseSteps[0].unit);
      }

      nextInterval = 0;
      nextRepetitions = 0;
    } else if (quality === 3) {
      nextEase = Math.max(1.3, ease_factor - 0.15);
      nextInterval = Math.max(1, Math.round(interval * 1.2));
      nextReviewDate = new Date(
        now.getTime() + nextInterval * 24 * 60 * 60 * 1000,
      );
      nextRepetitions += 1;
    } else if (quality === 4) {
      nextInterval = Math.max(1, Math.round(interval * ease_factor));
      nextReviewDate = new Date(
        now.getTime() + nextInterval * 24 * 60 * 60 * 1000,
      );
      nextRepetitions += 1;
    } else {
      nextEase = ease_factor + 0.15;
      nextInterval = Math.max(
        1,
        Math.round(interval * ease_factor * easyBonus),
      );
      nextReviewDate = new Date(
        now.getTime() + nextInterval * 24 * 60 * 60 * 1000,
      );
      nextRepetitions += 1;
    }
  } else if (state === 3) {
    const activeLapse =
      lapseSteps[Math.min(nextLearningStep, lapseSteps.length - 1)];
    if (quality < 3) {
      nextLearningStep = 0;
      nextReviewDate = addTime(now, lapseSteps[0].val, lapseSteps[0].unit);
      nextInterval = 0;
    } else if (quality === 3) {
      const currentVal = activeLapse.val * (activeLapse.unit === "h" ? 60 : 1);
      const stepVal = Math.round(currentVal * 1.5);
      nextReviewDate = addTime(now, stepVal, "m");
      nextInterval = 0;
    } else if (quality === 4) {
      if (nextLearningStep < lapseSteps.length - 1) {
        nextLearningStep += 1;
        nextReviewDate = addTime(
          now,
          lapseSteps[nextLearningStep].val,
          lapseSteps[nextLearningStep].unit,
        );
        nextInterval = 0;
      } else {
        nextState = 2;
        nextLearningStep = 0;
        nextInterval = 1;
        nextReviewDate = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
        nextRepetitions = 1;
      }
    } else {
      nextState = 2;
      nextLearningStep = 0;
      nextInterval = 4;
      nextReviewDate = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);
      nextRepetitions = 1;
    }
  }

  return {
    ease_factor: Math.round(nextEase * 100) / 100,
    interval: nextInterval,
    repetitions: nextRepetitions,
    state: nextState,
    learning_step: nextLearningStep,
    next_review: nextReviewDate.toISOString(),
    last_reviewed: now.toISOString(),
  };
}

export function getCardPreviews(
  card: SrsCardInput,
  settings?: Partial<DeckSettings> | null,
): { again: string; hard: string; good: string; easy: string } {
  const now = new Date();

  const againState = calculateNextSrsState(card, 1, settings);
  const hardState = calculateNextSrsState(card, 3, settings);
  const goodState = calculateNextSrsState(card, 4, settings);
  const easyState = calculateNextSrsState(card, 5, settings);

  const formatStr = (
    nextReviewStr: string,
    interval: number,
    state: number,
  ): string => {
    if (state === 1 || state === 3) {
      const diffMs = new Date(nextReviewStr).getTime() - now.getTime();
      const diffMins = Math.max(1, Math.round(diffMs / (60 * 1000)));
      if (diffMins < 60) return `${diffMins}m`;
      const diffHours = Math.round(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h`;
      return `${Math.round(diffHours / 24)}d`;
    }
    if (interval < 30) return `${interval}d`;
    if (interval < 365) return `${Math.round(interval / 30)}mo`;
    return `${Math.round(interval / 365)}y`;
  };

  return {
    again: formatStr(
      againState.next_review,
      againState.interval,
      againState.state,
    ),
    hard: formatStr(hardState.next_review, hardState.interval, hardState.state),
    good: formatStr(goodState.next_review, goodState.interval, goodState.state),
    easy: formatStr(easyState.next_review, easyState.interval, easyState.state),
  };
}

export function formatRelativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "Never studied";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return `${diffDays} days ago`;
}
