import { describe, it, expect } from 'vitest'
import {
  isChatModel,
  isWithinRecencyWindow,
  dedupeAliases,
  baseAliasOf,
  applyCatalogGuardrails,
  inferModelFamily,
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

  it('classifies OpenAI families', () => {
    expect(inferModelFamily('openai', 'gpt-5.1')).toBe('Flagship')
    expect(inferModelFamily('openai', 'gpt-5.1-mini')).toBe('Mini')
    expect(inferModelFamily('openai', 'o4-mini')).toBe('Mini')
    expect(inferModelFamily('openai', 'o3')).toBe('Reasoning')
  })

  it('returns null for unknown providers', () => {
    expect(inferModelFamily('custom', 'llama3.2:3b')).toBe(null)
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
