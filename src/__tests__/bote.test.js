import { describe, it, expect } from 'vitest'
import {
  computeEstimates,
  defaultInputs,
  sanitizeInput,
  sanitizeInputs,
  formatCount,
  formatBytes,
  formatBytesPerSec,
  formatBitrate,
  formatQps,
  formatLatency,
  sumLatencyBudget,
  buildMarkdownSummary,
  LATENCY_NUMBERS,
  SCENARIOS,
  BOTE_INPUT_DEFS,
} from '../utils/bote'

describe('computeEstimates — reference case (1M DAU / 10 req / 10:1)', () => {
  // Default inputs: dau=1M, requests=10, ratio=10:1, peak=3,
  // payload=2KB, media=10% @ 500KB, retention=5y, RF=3, cache=20%
  const est = computeEstimates(defaultInputs())

  it('splits requests into reads and writes by the R:W ratio', () => {
    expect(est.requestsPerDay).toBe(10_000_000)
    expect(est.writesPerDay).toBeCloseTo(10_000_000 / 11, 0)
    expect(est.readsPerDay).toBeCloseTo((10_000_000 * 10) / 11, 0)
  })

  it('computes average and peak QPS', () => {
    expect(est.avgWriteQps).toBeCloseTo(10.52, 1)
    expect(est.avgReadQps).toBeCloseTo(105.2, 0)
    expect(est.avgTotalQps).toBeCloseTo(115.7, 0)
    expect(est.peakTotalQps).toBeCloseTo(347.2, 0)
  })

  it('blends media into the average transfer size', () => {
    // 2 KB payload + 10% × 500 KB media = 52 KB
    expect(est.avgTransferBytes).toBe(52_000)
  })

  it('computes storage: day, year, and retained with replication', () => {
    expect(est.ingestPerDayBytes).toBeCloseTo(4.727e10, -8)
    expect(est.storagePerYearBytes).toBeCloseTo(1.725e13, -11)
    // 5 years × 3 replicas ≈ 259 TB
    expect(est.replicatedRetainedBytes).toBeCloseTo(2.588e14, -12)
    expect(est.fiveYearReplicatedBytes).toBeCloseTo(est.replicatedRetainedBytes, -12)
  })

  it('computes the 80/20 working-set cache and node count', () => {
    // 20% of ~473 GB daily read volume ≈ 94.5 GB
    expect(est.cacheBytes).toBeCloseTo(9.455e10, -9)
    // 64 GB nodes at 75% usable = 48 GB → 2 nodes
    expect(est.cacheNodes).toBe(2)
  })

  it('computes peak bandwidth in bits per second', () => {
    expect(est.ingressBps).toBeCloseTo(1.313e7, -5)
    expect(est.egressBps).toBeCloseTo(1.313e8, -6)
  })

  it('computes hardware from peak QPS and shard size', () => {
    // 347 QPS ÷ (1000 × 70%) → 1 server
    expect(est.appServers).toBe(1)
    // raw retained 86.3 TB ÷ 2 TB → 44 shards
    expect(est.dbShards).toBe(44)
  })
})

describe('computeEstimates — edge cases', () => {
  it('returns all zeros for zero DAU (no NaN, no Infinity)', () => {
    const est = computeEstimates({ ...defaultInputs(), dau: 0 })
    for (const [key, value] of Object.entries(est)) {
      if (key === 'inputs') continue
      expect(Number.isFinite(value), key).toBe(true)
      // avgTransferBytes is a per-request size — traffic-independent.
      if (key === 'avgTransferBytes') continue
      expect(value, key).toBe(0)
    }
  })

  it('handles a pure-write system (ratio 0:1)', () => {
    const est = computeEstimates({ ...defaultInputs(), readRatio: 0 })
    expect(est.readsPerDay).toBe(0)
    expect(est.writesPerDay).toBe(est.requestsPerDay)
    expect(est.cacheBytes).toBe(0)
    expect(est.egressBps).toBe(0)
  })

  it('stays finite at extreme scale (2B DAU × 10K requests)', () => {
    const est = computeEstimates({
      ...defaultInputs(),
      dau: 2_000_000_000,
      requestsPerUser: 10_000,
      payloadKB: 100_000,
      mediaPercent: 100,
      mediaSizeKB: 1_000_000,
    })
    for (const [key, value] of Object.entries(est)) {
      if (key === 'inputs') continue
      expect(Number.isFinite(value), key).toBe(true)
      expect(value, key).toBeGreaterThanOrEqual(0)
    }
    // 2e13 requests/day ≈ 231M average QPS
    expect(est.avgTotalQps).toBeCloseTo(2.315e8, -6)
  })

  it('replication factor scales retained storage linearly', () => {
    const base = computeEstimates({ ...defaultInputs(), replicationFactor: 1 })
    const tripled = computeEstimates({ ...defaultInputs(), replicationFactor: 3 })
    expect(tripled.replicatedRetainedBytes).toBeCloseTo(base.replicatedRetainedBytes * 3, -6)
  })

  it('overhead percent inflates retained storage', () => {
    const base = computeEstimates(defaultInputs())
    const withOverhead = computeEstimates({ ...defaultInputs(), overheadPercent: 30 })
    expect(withOverhead.rawRetainedBytes).toBeCloseTo(base.rawRetainedBytes * 1.3, -6)
  })
})

describe('input sanitization', () => {
  it('clamps to the definition range', () => {
    expect(sanitizeInput('dau', -5)).toBe(0)
    expect(sanitizeInput('dau', 1e15)).toBe(2_000_000_000)
    expect(sanitizeInput('replicationFactor', 0)).toBe(1)
    expect(sanitizeInput('utilizationPercent', 500)).toBe(100)
  })

  it('replaces NaN and garbage with the default', () => {
    expect(sanitizeInput('dau', 'not-a-number')).toBe(1_000_000)
    expect(sanitizeInput('dau', NaN)).toBe(1_000_000)
    expect(sanitizeInput('dau', Infinity)).toBe(1_000_000)
  })

  it('fills missing keys with defaults', () => {
    const inputs = sanitizeInputs({ dau: 500 })
    expect(inputs.dau).toBe(500)
    for (const def of BOTE_INPUT_DEFS) {
      expect(inputs[def.key]).toBeDefined()
    }
  })

  it('returns 0 for unknown keys', () => {
    expect(sanitizeInput('nonexistent', 42)).toBe(0)
  })
})

describe('formatters', () => {
  it('formats counts across magnitudes', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(999)).toBe('999')
    expect(formatCount(1234)).toBe('1.23K')
    expect(formatCount(1_000_000)).toBe('1M')
    expect(formatCount(2.5e9)).toBe('2.5B')
    expect(formatCount(7.2e12)).toBe('7.2T')
  })

  it('formats bytes with SI units up to EB', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(999)).toBe('999 B')
    expect(formatBytes(1e3)).toBe('1 KB')
    expect(formatBytes(1.5e6)).toBe('1.5 MB')
    expect(formatBytes(1e15)).toBe('1 PB')
    expect(formatBytes(3.21e18)).toBe('3.21 EB')
  })

  it('formats rates and QPS', () => {
    expect(formatBytesPerSec(2.5e6)).toBe('2.5 MB/s')
    expect(formatBitrate(1.313e9)).toBe('1.31 Gbps')
    expect(formatQps(1160)).toBe('1.16K QPS')
  })

  it('formats latency from ns to seconds', () => {
    expect(formatLatency(0.5)).toBe('0.5 ns')
    expect(formatLatency(10_000)).toBe('10 µs')
    expect(formatLatency(150e6)).toBe('150 ms')
    expect(formatLatency(2.5e9)).toBe('2.5 s')
  })

  it('handles non-finite input gracefully', () => {
    expect(formatCount(NaN)).toBe('—')
    expect(formatBytes(Infinity)).toBe('—')
    expect(formatLatency(NaN)).toBe('—')
  })
})

describe('latency budget', () => {
  it('sums items by count', () => {
    const azRtt = LATENCY_NUMBERS.find((l) => l.id === 'az-rtt')
    const nvme = LATENCY_NUMBERS.find((l) => l.id === 'nvme-read-4k')
    const total = sumLatencyBudget([
      { id: 'az-rtt', count: 2 },
      { id: 'nvme-read-4k', count: 3 },
    ])
    expect(total).toBe(azRtt.ns * 2 + nvme.ns * 3)
  })

  it('ignores unknown ids and negative counts', () => {
    expect(sumLatencyBudget([{ id: 'ghost', count: 5 }])).toBe(0)
    expect(sumLatencyBudget([{ id: 'az-rtt', count: -2 }])).toBe(0)
    expect(sumLatencyBudget([])).toBe(0)
  })
})

describe('scenarios and export', () => {
  it('every scenario preset only sets known input keys', () => {
    const knownKeys = new Set(BOTE_INPUT_DEFS.map((d) => d.key))
    for (const scenario of SCENARIOS) {
      for (const key of Object.keys(scenario.inputs || {})) {
        expect(knownKeys.has(key), `${scenario.id}.${key}`).toBe(true)
      }
    }
  })

  it('builds a markdown summary with LaTeX formulas and key results', () => {
    const est = computeEstimates(defaultInputs())
    const md = buildMarkdownSummary(est, {
      scenarioName: 'Social Feed',
      latencyBudget: [{ id: 'az-rtt', count: 1 }],
    })
    expect(md).toContain('## Back-of-the-Envelope Estimate — Social Feed')
    expect(md).toContain('$$QPS_{write}')
    expect(md).toContain('### Storage')
    expect(md).toContain('### Latency Budget')
    expect(md).toContain('1 × Cross-AZ round trip (same region) = 1 ms')
    expect(md).not.toContain('NaN')
    expect(md).not.toContain('undefined')
  })
})
