import type { KitSkeletonV1 } from '../../../shared/kits/kitSkeleton'

export type PersonaId = 'socratic' | 'eli5' | 'gordon' | 'devil'

export interface PersonaDef {
  id: PersonaId
  name: string
  icon: string
  context: string
  steeringStyle: string
}

export const PERSONAS: Record<PersonaId, PersonaDef> = {
  socratic: {
    id: 'socratic',
    name: 'Socratic Tutor',
    icon: '💡',
    context: 'You are an expert system design interview coach. Help the user study deeply through explanation, examples, analogies, and Socratic questioning. Correct misconceptions, surface edge cases, and highlight what separates good from great interview answers. Be concise but thorough. Format responses clearly with markdown.',
    steeringStyle: 'When the current topic is exhausted or there is a natural pause, smoothly transition by asking a thought-provoking Socratic question about the next uncovered section. For example: "Now that we understand X, what do you think would happen if we considered Y?" or "How would this change if we looked at it from the perspective of [next section]?" Only introduce ONE new section at a time.',
  },
  eli5: {
    id: 'eli5',
    name: "Explain Like I'm 5",
    icon: '🧸',
    context: 'You are an expert tutor. Explain concepts using extremely simple language, every-day analogies (like Legos, pizza delivery, water pipes), and avoid jargon entirely. Break down complex system design topics so a 5-year-old could intuitively understand the core mechanics.',
    steeringStyle: 'When the current topic is exhausted, gently introduce the next uncovered section with a fun analogy or story. For example: "Great, you understand X! Now imagine you had a lemonade stand and needed to handle [next section concept]..." Only introduce ONE new section at a time. Keep it playful.',
  },
  gordon: {
    id: 'gordon',
    name: 'Strict',
    icon: '🔥',
    context: "You are a highly demanding, intense, and strict engineering manager. You speak directly, concisely, and with a sense of urgency. You do not tolerate fluff or buzzwords. Point out flaws in the user's reasoning immediately, demand precision, but remain deeply educational and ensure they actually learn the right way to build systems.",
    steeringStyle: 'When the current topic is exhausted, firmly direct the user to the next uncovered section. For example: "Alright, you\'ve got a handle on X. But you haven\'t said a WORD about [next section]. Explain it. Now." Be direct and demanding but educational. Only move to ONE new section at a time.',
  },
  devil: {
    id: 'devil',
    name: "Devil's Advocate",
    icon: '👿',
    context: 'You are a ruthless technical critic and debate simulator. Whatever the user proposes, you politely but aggressively disagree and poke holes in their logic, scalability, or fault-tolerance. Force the user to defend their architectural choices vigorously. This is for interview prep, so be rigorous.',
    steeringStyle: 'When the current topic is exhausted, challenge the user about their gaps: "You\'ve been suspiciously silent about [next section]. What happens when [failure scenario related to that section]? I bet your design falls apart." Provoke them into exploring the uncovered section. Only raise ONE new section at a time.',
  },
}

export const DEFAULT_STARTER_PROMPTS: string[] = [
  'Explain consistent hashing with a concrete example and when I should use it',
  'Walk me through the tradeoffs of SQL vs NoSQL for a social feed at scale',
  'How do circuit breakers work and what are the most common misconfiguration mistakes?',
  'Explain the CAP theorem — which real systems sacrifice C vs A and why?',
  'Compare Kafka, RabbitMQ, and SQS: when does each shine?',
  'What separates a Senior from a Principal answer in a system design interview?',
]

type RawPersonaEntry = KitSkeletonV1['tutor']['personas']['socratic'] | string | undefined

function resolvePersonaPrompt(entry: RawPersonaEntry, fallback: string): string {
  if (!entry) return fallback
  if (typeof entry === 'string') return entry
  if (typeof entry === 'object' && typeof entry.prompt === 'string' && entry.prompt.trim()) {
    return entry.prompt
  }
  return fallback
}

function resolvePersonaLabel(entry: RawPersonaEntry, fallback: string): string {
  if (entry && typeof entry === 'object' && typeof entry.label === 'string' && entry.label.trim()) {
    return entry.label
  }
  return fallback
}

/**
 * Builds active tutor personas from a Kit's `skeleton.tutor` while preserving
 * exact legacy System Design personas when no custom Kit is active.
 */
export function buildPersonasForKit(
  tutor: KitSkeletonV1['tutor'] | null | undefined,
  isCustomKit: boolean,
): Record<PersonaId, PersonaDef> {
  if (!isCustomKit || !tutor) return PERSONAS
  const base = tutor.rolePrompt ? `${tutor.rolePrompt.trim()}\n\n` : ''
  const custom: Partial<Record<string, RawPersonaEntry>> = tutor.personas || {}
  return {
    socratic: {
      ...PERSONAS.socratic,
      name: resolvePersonaLabel(custom.socratic, PERSONAS.socratic.name),
      context: `${base}${resolvePersonaPrompt(custom.socratic, PERSONAS.socratic.context)}`,
    },
    eli5: {
      ...PERSONAS.eli5,
      name: resolvePersonaLabel(custom.eli5, PERSONAS.eli5.name),
      context: `${base}${resolvePersonaPrompt(custom.eli5, PERSONAS.eli5.context)}`,
    },
    gordon: {
      ...PERSONAS.gordon,
      name: resolvePersonaLabel(custom.strict, PERSONAS.gordon.name),
      context: `${base}${resolvePersonaPrompt(custom.strict, PERSONAS.gordon.context)}`,
    },
    devil: {
      ...PERSONAS.devil,
      name: resolvePersonaLabel(custom.devil, PERSONAS.devil.name),
      context: `${base}${resolvePersonaPrompt(custom.devil, PERSONAS.devil.context)}`,
    },
  }
}

export function getStarterPromptsForKit(
  tutor: KitSkeletonV1['tutor'] | null | undefined,
  isCustomKit: boolean,
): string[] {
  if (isCustomKit && Array.isArray(tutor?.starterPrompts) && tutor.starterPrompts.length > 0) {
    return tutor.starterPrompts
  }
  return DEFAULT_STARTER_PROMPTS
}
