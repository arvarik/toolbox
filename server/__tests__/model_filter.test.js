import { describe, it, expect } from 'vitest'
import {
  isChatModel,
  isWithinRecencyWindow,
  dedupeAliases,
  baseAliasOf,
  applyCatalogGuardrails,
  inferModelFamily,
  extractGeneration,
  isPreviewVariant,
  keepLatestPerFamily,
  prettyModelName,
  RECENCY_WINDOW_MS,
} from '../providers/model_filter.js'
import { maskSecret, isMaskedValue } from '../utils/mask.js'

const NOW = Date.parse('2026-08-16T00:00:00Z')
const DAY = 24 * 60 * 60 * 1000

describe('modality guardrails (isChatModel)', () => {
  it('keeps chat and reasoning models', () => {
    const chatModels = [
      'gpt-5.1',
      'gpt-5.1-mini',
      'o4-mini',
      'chatgpt-4o-latest',
      'claude-sonnet-4-6',
      'claude-opus-4-8',
      'gemini-3.5-flash',
      'gemini-3.1-flash-lite',
      'llama3.2:3b',
      'qwen2.5-coder',
    ]
    for (const id of chatModels) {
      expect(isChatModel(id), id).toBe(true)
    }
  })

  it('drops embedding models', () => {
    expect(isChatModel('text-embedding-3-large')).toBe(false)
    expect(isChatModel('gemini-embedding-001')).toBe(false)
    expect(isChatModel('nomic-embed-text')).toBe(false)
  })

  it('drops audio, transcription, and speech models', () => {
    expect(isChatModel('whisper-1')).toBe(false)
    expect(isChatModel('gpt-4o-transcribe')).toBe(false)
    expect(isChatModel('gpt-4o-mini-tts')).toBe(false)
    expect(isChatModel('gpt-4o-audio-preview')).toBe(false)
    expect(isChatModel('gpt-4o-realtime-preview')).toBe(false)
    expect(isChatModel('gemini-2.5-flash-preview-tts')).toBe(false)
  })

  it('drops image and video generation models', () => {
    expect(isChatModel('dall-e-3')).toBe(false)
    expect(isChatModel('gpt-image-1')).toBe(false)
    expect(isChatModel('imagen-4.0-generate-001')).toBe(false)
    expect(isChatModel('veo-3.1-generate-preview')).toBe(false)
  })

  it('drops moderation and legacy completion models', () => {
    expect(isChatModel('omni-moderation-latest')).toBe(false)
    expect(isChatModel('text-moderation-007')).toBe(false)
    expect(isChatModel('babbage-002')).toBe(false)
    expect(isChatModel('davinci-002')).toBe(false)
    expect(isChatModel('gpt-3.5-turbo-instruct')).toBe(false)
  })

  it('handles empty input', () => {
    expect(isChatModel('')).toBe(false)
    expect(isChatModel(undefined)).toBe(false)
  })
})

describe('recency guardrail (isWithinRecencyWindow)', () => {
  it('keeps models released within the last year', () => {
    expect(isWithinRecencyWindow(NOW - 30 * DAY, NOW)).toBe(true)
    expect(isWithinRecencyWindow(NOW - 364 * DAY, NOW)).toBe(true)
  })

  it('drops models released over a year ago', () => {
    expect(isWithinRecencyWindow(NOW - 366 * DAY, NOW)).toBe(false)
    expect(isWithinRecencyWindow(NOW - 3 * 365 * DAY, NOW)).toBe(false)
  })

  it('keeps the exact boundary', () => {
    expect(isWithinRecencyWindow(NOW - RECENCY_WINDOW_MS, NOW)).toBe(true)
  })

  it('keeps models without a release timestamp', () => {
    expect(isWithinRecencyWindow(null, NOW)).toBe(true)
    expect(isWithinRecencyWindow(undefined, NOW)).toBe(true)
  })
})

describe('alias dedupe (dedupeAliases / baseAliasOf)', () => {
  it('strips snapshot suffixes', () => {
    expect(baseAliasOf('gpt-4o-2024-08-06')).toBe('gpt-4o')
    expect(baseAliasOf('claude-3-5-haiku-20241022')).toBe('claude-3-5-haiku')
    expect(baseAliasOf('gpt-4-0613')).toBe('gpt-4')
    expect(baseAliasOf('gpt-5.1')).toBe('gpt-5.1')
  })

  it('drops pinned snapshots when the floating alias exists', () => {
    const result = dedupeAliases([
      { id: 'gpt-4o' },
      { id: 'gpt-4o-2024-08-06' },
      { id: 'gpt-4o-2024-11-20' },
      { id: 'o4-mini' },
    ])
    expect(result.map((m) => m.id)).toEqual(['gpt-4o', 'o4-mini'])
  })

  it('keeps a snapshot when no floating alias exists', () => {
    const result = dedupeAliases([{ id: 'claude-sonnet-4-6-20251001' }])
    expect(result.map((m) => m.id)).toEqual(['claude-sonnet-4-6-20251001'])
  })

  it('collapses exact duplicate IDs', () => {
    const result = dedupeAliases([{ id: 'gpt-5.1' }, { id: 'gpt-5.1' }])
    expect(result).toHaveLength(1)
  })
})

describe('applyCatalogGuardrails (all passes combined)', () => {
  it('filters modality, recency, and aliases in one pass', () => {
    const raw = [
      { id: 'gpt-5.1', releasedAt: NOW - 10 * DAY },
      { id: 'gpt-5.1-2026-08-01', releasedAt: NOW - 15 * DAY },
      { id: 'gpt-4-0613', releasedAt: NOW - 3 * 365 * DAY },
      { id: 'text-embedding-3-large', releasedAt: NOW - 5 * DAY },
      { id: 'whisper-1', releasedAt: NOW - 5 * DAY },
      { id: 'gemini-3.5-flash', releasedAt: null },
    ]
    const result = applyCatalogGuardrails(raw, NOW)
    expect(result.map((m) => m.id)).toEqual(['gpt-5.1', 'gemini-3.5-flash'])
  })
})

describe('family inference', () => {
  it('classifies Gemini families', () => {
    expect(inferModelFamily('gemini', 'gemini-3.5-flash')).toBe('Flash')
    expect(inferModelFamily('gemini', 'gemini-3.1-pro')).toBe('Pro')
    expect(inferModelFamily('gemini', 'gemini-3.1-flash-lite')).toBe('Flash-Lite')
  })

  it('classifies Claude families', () => {
    expect(inferModelFamily('claude', 'claude-sonnet-4-6')).toBe('Sonnet')
    expect(inferModelFamily('claude', 'claude-haiku-4-5')).toBe('Haiku')
    expect(inferModelFamily('claude', 'claude-opus-4-8')).toBe('Opus')
  })

  it('classifies OpenAI families including the GPT-5.6 tier names', () => {
    expect(inferModelFamily('openai', 'gpt-5.6-sol')).toBe('Flagship')
    expect(inferModelFamily('openai', 'gpt-5.6-terra')).toBe('Balanced')
    expect(inferModelFamily('openai', 'gpt-5.6-luna')).toBe('Fast')
    expect(inferModelFamily('openai', 'gpt-5.2')).toBe('Flagship')
    expect(inferModelFamily('openai', 'gpt-5.2-mini')).toBe('Mini')
    expect(inferModelFamily('openai', 'gpt-5.2-nano')).toBe('Nano')
    expect(inferModelFamily('openai', 'o3')).toBe('Reasoning')
  })

  it('classifies Fable and Gemma', () => {
    expect(inferModelFamily('claude', 'claude-fable-5')).toBe('Fable')
    expect(inferModelFamily('gemini', 'gemma-4-31b-it')).toBe('Gemma')
  })

  it('returns null for unknown providers', () => {
    expect(inferModelFamily('custom', 'llama3.2:3b')).toBe(null)
  })
})

describe('generation extraction (extractGeneration)', () => {
  it('reads dotted and dashed version numbers', () => {
    expect(extractGeneration('gemini-3.6-flash')).toBe(3.6)
    expect(extractGeneration('gpt-5.6-sol')).toBe(5.6)
    expect(extractGeneration('claude-opus-4-8')).toBe(4.8)
    expect(extractGeneration('claude-opus-5')).toBe(5)
    expect(extractGeneration('claude-haiku-4-5')).toBe(4.5)
    expect(extractGeneration('o4-mini')).toBe(4)
  })

  it('ignores snapshot date suffixes', () => {
    expect(extractGeneration('claude-opus-4-5-20251101')).toBe(4.5)
  })

  it('returns null when no version exists', () => {
    expect(extractGeneration('gemini-flash-latest')).toBe(null)
    expect(extractGeneration('')).toBe(null)
  })
})

describe('preview variant detection (isPreviewVariant)', () => {
  it('flags preview, experimental, and latest aliases', () => {
    expect(isPreviewVariant('gemini-3.6-flash-preview-06-17')).toBe(true)
    expect(isPreviewVariant('gemini-exp-1206')).toBe(true)
    expect(isPreviewVariant('gemini-flash-latest')).toBe(true)
    expect(isPreviewVariant('chatgpt-4o-latest')).toBe(true)
  })

  it('passes stable releases', () => {
    expect(isPreviewVariant('gemini-3.6-flash')).toBe(false)
    expect(isPreviewVariant('claude-opus-5')).toBe(false)
    expect(isPreviewVariant('gpt-5.6-sol')).toBe(false)
  })
})

describe('latest-per-family reduction (keepLatestPerFamily)', () => {
  it('keeps only the newest generation of each Gemini family', () => {
    const raw = [
      { id: 'gemini-2.5-flash' },
      { id: 'gemini-3.5-flash' },
      { id: 'gemini-3.6-flash' },
      { id: 'gemini-flash-latest' },
      { id: 'gemini-2.5-pro' },
      { id: 'gemini-3.1-pro' },
      { id: 'gemini-pro-latest' },
      { id: 'gemini-2.5-flash-lite' },
      { id: 'gemini-3.5-flash-lite' },
      { id: 'gemini-flash-lite-latest' },
    ]
    const result = keepLatestPerFamily('gemini', raw).map((m) => m.id)
    expect(result).toEqual(['gemini-3.1-pro', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'])
  })

  it('keeps only the newest generation of each Claude family', () => {
    const raw = [
      { id: 'claude-opus-5' },
      { id: 'claude-sonnet-5' },
      { id: 'claude-fable-5' },
      { id: 'claude-opus-4-8' },
      { id: 'claude-opus-4-7' },
      { id: 'claude-sonnet-4-6' },
      { id: 'claude-opus-4-5-20251101' },
      { id: 'claude-haiku-4-5' },
    ]
    const result = keepLatestPerFamily('claude', raw).map((m) => m.id)
    expect(result).toEqual(['claude-fable-5', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'])
  })

  it('keeps only the newest generation of each OpenAI family', () => {
    const raw = [
      { id: 'gpt-5.6-sol' },
      { id: 'gpt-5.6-terra' },
      { id: 'gpt-5.6-luna' },
      { id: 'gpt-5.2' },
      { id: 'gpt-5.1' },
      { id: 'gpt-5.2-mini' },
      { id: 'gpt-5.2-nano' },
      { id: 'o4-mini' },
    ]
    const result = keepLatestPerFamily('openai', raw).map((m) => m.id)
    expect(result).toEqual(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.2-mini', 'gpt-5.2-nano'])
  })

  it('prefers stable releases over previews within the same generation', () => {
    const raw = [
      { id: 'gemini-3.6-flash' },
      { id: 'gemini-3.6-flash-preview-06-17' },
    ]
    const result = keepLatestPerFamily('gemini', raw).map((m) => m.id)
    expect(result).toEqual(['gemini-3.6-flash'])
  })

  it('keeps an alias when its family has no versioned model', () => {
    const raw = [{ id: 'gemini-pro-latest' }]
    const result = keepLatestPerFamily('gemini', raw).map((m) => m.id)
    expect(result).toEqual(['gemini-pro-latest'])
  })

  it('passes unclassifiable models through unchanged', () => {
    const raw = [{ id: 'mystery-model-1' }, { id: 'mystery-model-2' }]
    const result = keepLatestPerFamily('gemini', raw).map((m) => m.id)
    expect(result).toEqual(['mystery-model-1', 'mystery-model-2'])
  })
})

describe('prettyModelName', () => {
  it('formats raw model IDs for display', () => {
    expect(prettyModelName('llama3.2:3b')).toBe('Llama3.2 3b')
    expect(prettyModelName('gpt-4o')).toBe('GPT 4o')
    expect(prettyModelName('models/gemini-3.5-flash')).toBe('Gemini 3.5 Flash')
  })
})

describe('credential masking (maskSecret)', () => {
  it('masks keys as bullets plus the last 4 characters', () => {
    expect(maskSecret('sk-ant-api03-abcdef1234')).toBe('••••1234')
    expect(maskSecret('AIzaSyD-9876')).toBe('••••9876')
  })

  it('never reveals short secrets', () => {
    expect(maskSecret('abcd')).toBe('••••')
    expect(maskSecret('ab')).toBe('••••')
  })

  it('returns empty string for empty values', () => {
    expect(maskSecret('')).toBe('')
    expect(maskSecret(null)).toBe('')
    expect(maskSecret(undefined)).toBe('')
  })

  it('detects masked values so they are never re-saved', () => {
    expect(isMaskedValue('••••1234')).toBe(true)
    expect(isMaskedValue('sk-real-key')).toBe(false)
  })
})

describe('specialized non-chat systems are excluded', () => {
  it('drops music, robotics, research-agent, and computer-use models', () => {
    expect(isChatModel('lyria-3-clip-preview')).toBe(false)
    expect(isChatModel('gemini-robotics-er-2-preview')).toBe(false)
    expect(isChatModel('gemini-2.5-computer-use-preview-10-2025')).toBe(false)
    expect(isChatModel('deep-research-pro-preview-12-2025')).toBe(false)
    expect(isChatModel('antigravity-preview-05-2026')).toBe(false)
  })

  it('does not let specialized models hijack a Gemini family', () => {
    expect(inferModelFamily('gemini', 'deep-research-pro-preview-12-2025')).toBe(null)
    expect(inferModelFamily('gemini', 'gemini-3.1-pro')).toBe('Pro')
  })
})

describe('suffix-variant collapse within a family', () => {
  it('keeps the base variant when a sibling only adds a suffix', () => {
    const raw = [
      { id: 'gemini-3.1-pro-preview' },
      { id: 'gemini-3.1-pro-preview-customtools' },
    ]
    const result = keepLatestPerFamily('gemini', raw).map((m) => m.id)
    expect(result).toEqual(['gemini-3.1-pro-preview'])
  })

  it('drops the Nano Banana image line entirely', () => {
    expect(isChatModel('nano-banana-pro-preview')).toBe(false)
  })
})
