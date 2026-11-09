import { describe, expect, it } from 'vitest'
import {
  BOTE_INPUT_DEFS,
  LATENCY_NUMBERS,
  SCENARIOS,
  buildMarkdownSummary,
  computeEstimates,
  defaultInputs,
  formatBitrate,
  formatBytes,
  formatBytesPerSec,
  formatCount,
  formatLatency,
  formatQps,
  sanitizeInput,
  sanitizeInputs,
  sumLatencyBudget,
} from '../utils/bote'
import type { BoteInputKey } from '../utils/bote'

describe('computeEstimates — reference case (1M DAU / 10 req / 10:1)', () => {
  const est = computeEstimates(defaultInputs())

  it('splits requests, QPS, media transfer, storage, cache, bandwidth, and hardware', () => {
    expect(est.requestsPerDay).toBe(10_000_000)
    expect(est.writesPerDay).toBeCloseTo(10_000_000 / 11, 0)
    expect(est.readsPerDay).toBeCloseTo((10_000_000 * 10) / 11, 0)

    expect(est.avgWriteQps).toBeCloseTo(10.52, 1)
    expect(est.avgReadQps).toBeCloseTo(105.2, 0)
    expect(est.avgTotalQps).toBeCloseTo(115.7, 0)
    expect(est.peakTotalQps).toBeCloseTo(347.2, 0)

    expect(est.avgTransferBytes).toBe(52_000)
    expect(est.ingestPerDayBytes).toBeCloseTo(4.727e10, -8)
    expect(est.storagePerYearBytes).toBeCloseTo(1.725e13, -11)
    expect(est.replicatedRetainedBytes).toBeCloseTo(2.588e14, -12)
    expect(est.fiveYearReplicatedBytes).toBeCloseTo(est.replicatedRetainedBytes, -12)

    expect(est.cacheBytes).toBeCloseTo(9.455e10, -9)
    expect(est.cacheNodes).toBe(2)
    expect(est.ingressBps).toBeCloseTo(1.313e7, -5)
    expect(est.egressBps).toBeCloseTo(1.313e8, -6)
    expect(est.appServers).toBe(1)
    expect(est.dbShards).toBe(44)
  })
})

describe('computeEstimates — edge cases', () => {
  it('returns finite zeros for zero DAU (except per-request avgTransferBytes)', () => {
    const est = computeEstimates({ ...defaultInputs(), dau: 0 })
    for (const [key, value] of Object.entries(est)) {
      if (typeof value !== 'number') continue
      expect(Number.isFinite(value), key).toBe(true)
      if (key !== 'avgTransferBytes') expect(value, key).toBe(0)
    }
  })

  it('handles pure-write (0:1) and extreme scale (2B DAU × 10K req) cleanly', () => {
    const writeOnly = computeEstimates({ ...defaultInputs(), readRatio: 0 })
    expect(writeOnly.readsPerDay).toBe(0)
    expect(writeOnly.writesPerDay).toBe(writeOnly.requestsPerDay)
    expect(writeOnly.cacheBytes).toBe(0)
    expect(writeOnly.egressBps).toBe(0)

    const extreme = computeEstimates({
      ...defaultInputs(),
      dau: 2_000_000_000,
      requestsPerUser: 10_000,
      payloadKB: 100_000,
      mediaPercent: 100,
      mediaSizeKB: 1_000_000,
    })
    for (const [key, value] of Object.entries(extreme)) {
      if (typeof value !== 'number') continue
      expect(Number.isFinite(value), key).toBe(true)
      expect(value, key).toBeGreaterThanOrEqual(0)
    }
    expect(extreme.avgTotalQps).toBeCloseTo(2.315e8, -6)
  })

  it('scales retained storage linearly with replication factor and overhead percent', () => {
    const baseRf = computeEstimates({ ...defaultInputs(), replicationFactor: 1 })
    const tripled = computeEstimates({ ...defaultInputs(), replicationFactor: 3 })
    expect(tripled.replicatedRetainedBytes).toBeCloseTo(baseRf.replicatedRetainedBytes * 3, -6)

    const base = computeEstimates(defaultInputs())
    const overhead = computeEstimates({ ...defaultInputs(), overheadPercent: 30 })
    expect(overhead.rawRetainedBytes).toBeCloseTo(base.rawRetainedBytes * 1.3, -6)
  })
})

describe('sanitization, formatters, latency budget, and export', () => {
  it('clamps out-of-range inputs, falls back on NaN/Infinity, fills defaults, and guards unknown keys', () => {
    expect(sanitizeInput('dau', -5)).toBe(0)
    expect(sanitizeInput('dau', 1e15)).toBe(2_000_000_000)
    expect(sanitizeInput('replicationFactor', 0)).toBe(1)
    expect(sanitizeInput('utilizationPercent', 500)).toBe(100)

    expect(sanitizeInput('dau', 'not-a-number')).toBe(1_000_000)
    expect(sanitizeInput('dau', NaN)).toBe(1_000_000)
    expect(sanitizeInput('dau', Infinity)).toBe(1_000_000)
    expect(sanitizeInput('nonexistent' as BoteInputKey, 42)).toBe(0)

    const inputs = sanitizeInputs({ dau: 500 })
    expect(inputs.dau).toBe(500)
    for (const def of BOTE_INPUT_DEFS) {
      expect(inputs[def.key]).toBeDefined()
    }
  })

  it('formats counts, bytes, rates, QPS, latency, and non-finite sentinels', () => {
    expect([formatCount(0), formatCount(999), formatCount(1234), formatCount(1_000_000), formatCount(2.5e9), formatCount(7.2e12)]).toEqual([
      '0', '999', '1.23K', '1M', '2.5B', '7.2T',
    ])
    expect([formatBytes(0), formatBytes(999), formatBytes(1e3), formatBytes(1.5e6), formatBytes(1e15), formatBytes(3.21e18)]).toEqual([
      '0 B', '999 B', '1 KB', '1.5 MB', '1 PB', '3.21 EB',
    ])
    expect(formatBytesPerSec(2.5e6)).toBe('2.5 MB/s')
    expect(formatBitrate(1.313e9)).toBe('1.31 Gbps')
    expect(formatQps(1160)).toBe('1.16K QPS')
    expect([formatLatency(0.5), formatLatency(10_000), formatLatency(150e6), formatLatency(2.5e9)]).toEqual([
      '0.5 ns', '10 µs', '150 ms', '2.5 s',
    ])
    expect([formatCount(NaN), formatBytes(Infinity), formatLatency(NaN)]).toEqual(['—', '—', '—'])
  })

  it('sums latency budget items and ignores unknown ids or negative counts', () => {
    const azRtt = LATENCY_NUMBERS.find((l) => l.id === 'az-rtt')
    const nvme = LATENCY_NUMBERS.find((l) => l.id === 'nvme-read-4k')
    expect(azRtt).toBeDefined()
    expect(nvme).toBeDefined()

    const total = sumLatencyBudget([
      { id: 'az-rtt', count: 2 },
      { id: 'nvme-read-4k', count: 3 },
    ])
    expect(total).toBe((azRtt?.ns ?? 0) * 2 + (nvme?.ns ?? 0) * 3)
    expect(sumLatencyBudget([{ id: 'ghost', count: 5 }])).toBe(0)
    expect(sumLatencyBudget([{ id: 'az-rtt', count: -2 }])).toBe(0)
    expect(sumLatencyBudget([])).toBe(0)
  })

  it('validates scenario keys and exports LaTeX markdown summaries cleanly', () => {
    const knownKeys = new Set<string>(BOTE_INPUT_DEFS.map((d) => d.key))
    for (const scenario of SCENARIOS) {
      for (const key of Object.keys(scenario.inputs ?? {})) {
        expect(knownKeys.has(key), `${scenario.id}.${key}`).toBe(true)
      }
    }

    const md = buildMarkdownSummary(computeEstimates(defaultInputs()), {
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
