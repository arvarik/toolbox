/**
 * @fileoverview SM-2 (Anki-variant) scheduling — extracted from the decks
 * route so the knowledge-graph routes can reuse previews and settings
 * parsing. Behavior is unchanged; see docs/srs-algorithm.md.
 */

export const DEFAULT_DECK_SETTINGS = {
  new_limit: 20,
  review_limit: 200,
  steps: '1m 10m',
  lapse_steps: '10m',
  easy_bonus: 1.3,
}

/** Parse a deck row's settings JSON, merged over the defaults. */
export function parseDeckSettings(settingsJson) {
  let settings = { ...DEFAULT_DECK_SETTINGS }
  if (settingsJson) {
    try {
      settings = { ...settings, ...JSON.parse(settingsJson) }
    } catch {
      // Malformed settings — fall back to defaults
    }
  }
  return settings
}

/**
 * @function calculateNextSrsState
 * @description Anki-style Spaced Repetition Scheduling Algorithm (SM-2 variant).
 * Supports New, Learning, Review, and Relearning states with sub-day step intervals.
 * Incorporates a "Hypercorrection Penalty" based on self-reported confidence.
 *
 * Quality maps:
 *   0, 1 -> Again (Failure)
 *   2, 3 -> Hard (Pass with difficulty)
 *   4    -> Good (Pass)
 *   5    -> Easy (Pass easily)
 *
 * @param {Object} card - The current card state (ease_factor, interval, state, learning_step).
 * @param {number} quality - User rating from 0-5.
 * @param {Object} settings - Deck SRS settings (steps, lapse_steps, easy_bonus).
 * @param {string} confidence - User confidence rating ('low', 'medium', 'high').
 * @returns {Object} The calculated next state properties for the flashcard.
 */
export function calculateNextSrsState(card, quality, settings, confidence = 'medium') {
  const ease_factor = card.ease_factor !== undefined && card.ease_factor !== null ? card.ease_factor : 2.5
  const interval = card.interval || 0
  const state = card.state || 0
  const learningStep = card.learning_step || 0

  const steps = settings?.steps ? settings.steps.split(' ').map(s => {
    const val = parseInt(s) || 1
    const unit = s.endsWith('h') ? 'h' : 'm'
    return { val, unit }
  }) : [{ val: 1, unit: 'm' }, { val: 10, unit: 'm' }]

  const lapseSteps = settings?.lapse_steps ? settings.lapse_steps.split(' ').map(s => {
    const val = parseInt(s) || 10
    const unit = s.endsWith('h') ? 'h' : 'm'
    return { val, unit }
  }) : [{ val: 10, unit: 'm' }]

  const easyBonus = settings?.easy_bonus || 1.3

  let nextState = state
  let nextLearningStep = learningStep
  let nextInterval = interval
  let nextRepetitions = card.repetitions || 0
  let nextEase = ease_factor

  const now = new Date()
  let nextReviewDate = new Date()

  const addTime = (date, val, unit) => {
    if (unit === 'h') {
      return new Date(date.getTime() + val * 60 * 60 * 1000)
    }
    return new Date(date.getTime() + val * 60 * 1000)
  }

  if (state === 0) { // New
    if (quality < 3) { // Again
      nextState = 1 // Learning
      nextLearningStep = 0
      nextReviewDate = addTime(now, lapseSteps[0].val, lapseSteps[0].unit)
      nextInterval = 0

      // Hypercorrection Penalty
      if (confidence === 'high') {
        nextEase = Math.max(1.3, nextEase - 0.4)
        nextReviewDate = addTime(now, Math.max(1, lapseSteps[0].val / 2), lapseSteps[0].unit)
      } else {
        nextEase = Math.max(1.3, nextEase - 0.2)
      }
      nextRepetitions = 0
    } else if (quality === 3) { // Hard
      nextState = 1 // Learning
      nextLearningStep = 0
      const firstVal = steps[0].val * (steps[0].unit === 'h' ? 60 : 1)
      const secondVal = (steps[1] || steps[0]).val * ((steps[1] || steps[0]).unit === 'h' ? 60 : 1)
      const stepVal = Math.round((firstVal + secondVal) / 2)
      nextReviewDate = addTime(now, stepVal, 'm')
      nextInterval = 0
      nextRepetitions = 0
    } else if (quality === 4) { // Good
      nextState = 1 // Learning
      if (steps.length > 1) {
        nextLearningStep = 1
        nextReviewDate = addTime(now, steps[1].val, steps[1].unit)
        nextRepetitions = 0
      } else {
        // Graduate immediately
        nextState = 2 // Review
        nextLearningStep = 0
        nextInterval = 1
        nextReviewDate = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000)
        nextRepetitions = 1
      }
    } else { // Easy
      nextState = 2 // Review
      nextLearningStep = 0
      nextInterval = 4
      nextReviewDate = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000)
      nextRepetitions = 1
    }
  }
  else if (state === 1) { // Learning
    if (quality < 3) { // Again
      nextLearningStep = 0
      nextReviewDate = addTime(now, steps[0].val, steps[0].unit)
      nextInterval = 0
    } else if (quality === 3) { // Hard
      const currentVal = steps[nextLearningStep].val * (steps[nextLearningStep].unit === 'h' ? 60 : 1)
      const stepVal = Math.round(currentVal * 1.5)
      nextReviewDate = addTime(now, stepVal, 'm')
      nextInterval = 0
    } else if (quality === 4) { // Good
      if (nextLearningStep < steps.length - 1) {
        nextLearningStep += 1
        nextReviewDate = addTime(now, steps[nextLearningStep].val, steps[nextLearningStep].unit)
        nextInterval = 0
      } else {
        // Graduate
        nextState = 2 // Review
        nextLearningStep = 0
        nextInterval = 1
        nextReviewDate = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000)
        nextRepetitions = 1
      }
    } else { // Easy
      nextState = 2 // Review
      nextLearningStep = 0
      nextInterval = 4
      nextReviewDate = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000)
      nextRepetitions = 1
    }
  }
  else if (state === 2) { // Review
    if (quality < 3) { // Again (Lapse)
      nextState = 3 // Relearning
      nextLearningStep = 0

      // Hypercorrection Penalty
      if (confidence === 'high') {
        nextEase = Math.max(1.3, ease_factor - 0.40)
        nextReviewDate = addTime(now, Math.max(1, lapseSteps[0].val / 2), lapseSteps[0].unit)
      } else {
        nextEase = Math.max(1.3, ease_factor - 0.20)
        nextReviewDate = addTime(now, lapseSteps[0].val, lapseSteps[0].unit)
      }

      nextInterval = 0
      nextRepetitions = 0
    } else if (quality === 3) { // Hard
      nextEase = Math.max(1.3, ease_factor - 0.15)
      nextInterval = Math.max(1, Math.round(interval * 1.2))
      nextReviewDate = new Date(now.getTime() + nextInterval * 24 * 60 * 60 * 1000)
      nextRepetitions += 1
    } else if (quality === 4) { // Good
      nextInterval = Math.max(1, Math.round(interval * ease_factor))
      nextReviewDate = new Date(now.getTime() + nextInterval * 24 * 60 * 60 * 1000)
      nextRepetitions += 1
    } else { // Easy
      nextEase = ease_factor + 0.15
      nextInterval = Math.max(1, Math.round(interval * ease_factor * easyBonus))
      nextReviewDate = new Date(now.getTime() + nextInterval * 24 * 60 * 60 * 1000)
      nextRepetitions += 1
    }
  }
  else if (state === 3) { // Relearning
    if (quality < 3) { // Again
      nextLearningStep = 0
      nextReviewDate = addTime(now, lapseSteps[0].val, lapseSteps[0].unit)
      nextInterval = 0
    } else if (quality === 3) { // Hard
      const currentVal = lapseSteps[nextLearningStep].val * (lapseSteps[nextLearningStep].unit === 'h' ? 60 : 1)
      const stepVal = Math.round(currentVal * 1.5)
      nextReviewDate = addTime(now, stepVal, 'm')
      nextInterval = 0
    } else if (quality === 4) { // Good
      if (nextLearningStep < lapseSteps.length - 1) {
        nextLearningStep += 1
        nextReviewDate = addTime(now, lapseSteps[nextLearningStep].val, lapseSteps[nextLearningStep].unit)
        nextInterval = 0
      } else {
        // Graduate
        nextState = 2 // Review
        nextLearningStep = 0
        nextInterval = 1
        nextReviewDate = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000)
        nextRepetitions = 1
      }
    } else { // Easy
      nextState = 2 // Review
      nextLearningStep = 0
      nextInterval = 4
      nextReviewDate = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000)
      nextRepetitions = 1
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
  }
}

/**
 * Get visual interval preview string for all 4 ratings (Again, Hard, Good, Easy)
 */
export function getCardPreviews(card, settings) {
  const now = new Date()

  const againState = calculateNextSrsState(card, 1, settings)
  const hardState = calculateNextSrsState(card, 3, settings)
  const goodState = calculateNextSrsState(card, 4, settings)
  const easyState = calculateNextSrsState(card, 5, settings)

  const formatStr = (nextReviewStr, interval, state) => {
    if (state === 1 || state === 3) {
      const diffMs = new Date(nextReviewStr) - now
      const diffMins = Math.max(1, Math.round(diffMs / (60 * 1000)))
      if (diffMins < 60) return `${diffMins}m`
      const diffHours = Math.round(diffMins / 60)
      if (diffHours < 24) return `${diffHours}h`
      return `${Math.round(diffHours / 24)}d`
    } else {
      if (interval < 30) return `${interval}d`
      if (interval < 365) return `${Math.round(interval / 30)}mo`
      return `${Math.round(interval / 365)}y`
    }
  }

  return {
    again: formatStr(againState.next_review, againState.interval, againState.state),
    hard: formatStr(hardState.next_review, hardState.interval, hardState.state),
    good: formatStr(goodState.next_review, goodState.interval, goodState.state),
    easy: formatStr(easyState.next_review, easyState.interval, easyState.state)
  }
}

/**
 * Format ISO timestamp to relative time string.
 */
export function formatRelativeTime(dateStr) {
  if (!dateStr) return 'Never studied'
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now - date
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays <= 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return `${diffDays} days ago`
}
