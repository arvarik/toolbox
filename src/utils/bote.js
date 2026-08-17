/**
 * @fileoverview Back-of-the-Envelope (BotE) calculation engine.
 *
 * Pure functions only — no React, no network, no globals. Every number the
 * Calculator page shows comes from `computeEstimates()`. The formulas follow
 * the standard interview conventions:
 *
 *   QPS        = DAU × requests/user/day ÷ 86,400
 *   Peak QPS   = average QPS × peak multiplier (2–5× is typical)
 *   Storage    = writes/day × record size × retention × replication × (1 + overhead)
 *   Cache      = working-set % × daily read volume  (the "80/20 rule")
 *   Bandwidth  = QPS × transfer size × 8 bits
 *   Servers    = peak QPS ÷ (QPS per node × target utilization)
 *
 * Unit convention: storage and bandwidth math uses SI decimal units
 * (1 KB = 1,000 bytes) — the convention used in capacity estimates.
 * The UI shows a binary powers-of-two reference table separately.
 */

export const SECONDS_PER_DAY = 86_400
export const DAYS_PER_YEAR = 365

/** RAM assumptions for the cache-node estimate (documented in the UI). */
export const CACHE_NODE_RAM_GB = 64
export const CACHE_NODE_USABLE_FRACTION = 0.75

/**
 * Input parameter definitions — single source of truth for the sandbox UI,
 * validation, and tests. `min`/`max` clamp user input; `log: true` renders
 * a logarithmic slider (for values spanning many orders of magnitude).
 */
export const BOTE_INPUT_DEFS = [
  {
    key: 'dau', label: 'Daily Active Users', unit: 'users',
    min: 0, max: 2_000_000_000, default: 1_000_000, log: true, logFloor: 1_000,
    group: 'traffic', help: 'How many distinct users hit the system per day.',
  },
  {
    key: 'requestsPerUser', label: 'Requests per User / Day', unit: 'req',
    min: 0, max: 10_000, default: 10, log: true, logFloor: 1,
    group: 'traffic', help: 'Average reads + writes one user makes in a day.',
  },
  {
    key: 'readRatio', label: 'Read : Write Ratio', unit: ': 1',
    min: 0, max: 10_000, default: 10, log: true, logFloor: 1,
    group: 'traffic', help: 'Reads per single write. Most consumer apps sit between 10:1 and 100:1.',
  },
  {
    key: 'peakMultiplier', label: 'Peak Traffic Multiplier', unit: '×',
    min: 1, max: 100, default: 3,
    group: 'traffic', help: 'Peak QPS over average QPS. 2–3× is a safe default; flash sales can hit 10×+.',
  },
  {
    key: 'payloadKB', label: 'Avg Payload Size', unit: 'KB',
    min: 0, max: 100_000, default: 2, log: true, logFloor: 0.1,
    group: 'data', help: 'Size of one written record / one read response, without media.',
  },
  {
    key: 'mediaPercent', label: 'Media / Attachment %', unit: '%',
    min: 0, max: 100, default: 10,
    group: 'data', help: 'Share of requests that carry a media object (image, clip, file).',
  },
  {
    key: 'mediaSizeKB', label: 'Avg Media Size', unit: 'KB',
    min: 0, max: 1_000_000, default: 500, log: true, logFloor: 1,
    group: 'data', help: 'Average size of one media object when present.',
  },
  {
    key: 'retentionYears', label: 'Data Retention', unit: 'yr',
    min: 0, max: 50, default: 5,
    group: 'data', help: 'How long written data must stay stored.',
  },
  {
    key: 'replicationFactor', label: 'Replication Factor', unit: '×',
    min: 1, max: 10, default: 3,
    group: 'data', help: 'Copies of each byte. 3 is the standard for durability.',
  },
  {
    key: 'overheadPercent', label: 'Index & Metadata Overhead', unit: '%',
    min: 0, max: 200, default: 0,
    group: 'advanced', help: 'Extra storage for indexes, metadata, tombstones. Real systems pay 20–40%. Left at 0, the AI audit will call it out.',
  },
  {
    key: 'cachePercent', label: 'Cached Working Set', unit: '%',
    min: 0, max: 100, default: 20,
    group: 'advanced', help: 'The 80/20 rule: ~20% of daily read volume serves ~80% of reads.',
  },
  {
    key: 'qpsPerServer', label: 'Target QPS per Server', unit: 'QPS',
    min: 1, max: 1_000_000, default: 1_000, log: true, logFloor: 10,
    group: 'advanced', help: 'Sustainable QPS for one app node at full saturation. Commodity nodes: 500–5,000.',
  },
  {
    key: 'utilizationPercent', label: 'Target CPU Utilization', unit: '%',
    min: 1, max: 100, default: 70,
    group: 'advanced', help: 'Run servers below 100% so peaks and failovers have headroom.',
  },
  {
    key: 'storagePerShardTB', label: 'Storage per Shard', unit: 'TB',
    min: 0.1, max: 1_000, default: 2,
    group: 'advanced', help: 'Practical data volume one database shard should own (keeps rebuilds and backups fast).',
  },
]

/** Default input object built from the definitions. */
export function defaultInputs() {
  const out = {}
  for (const def of BOTE_INPUT_DEFS) out[def.key] = def.default
  return out
}

/** Clamp and sanitize one input value against its definition. */
export function sanitizeInput(key, value) {
  const def = BOTE_INPUT_DEFS.find((d) => d.key === key)
  if (!def) return 0
  const num = Number(value)
  if (!Number.isFinite(num)) return def.default
  return Math.min(def.max, Math.max(def.min, num))
}

/** Sanitize a whole input object; missing keys fall back to defaults. */
export function sanitizeInputs(inputs = {}) {
  const out = {}
  for (const def of BOTE_INPUT_DEFS) {
    out[def.key] = sanitizeInput(def.key, inputs[def.key] ?? def.default)
  }
  return out
}

/**
 * Compute every estimate from the input set.
 *
 * @param {Object} rawInputs - Values keyed by BOTE_INPUT_DEFS keys.
 * @returns {Object} All derived values in base units (QPS, bytes, bytes/s,
 *   bits/s, counts). Formatting happens in the UI layer.
 */
export function computeEstimates(rawInputs) {
  const inp = sanitizeInputs(rawInputs)

  // ── Traffic ──
  const requestsPerDay = inp.dau * inp.requestsPerUser
  const writeShare = 1 / (inp.readRatio + 1)
  const writesPerDay = requestsPerDay * writeShare
  const readsPerDay = requestsPerDay - writesPerDay

  const avgWriteQps = writesPerDay / SECONDS_PER_DAY
  const avgReadQps = readsPerDay / SECONDS_PER_DAY
  const avgTotalQps = requestsPerDay / SECONDS_PER_DAY
  const peakWriteQps = avgWriteQps * inp.peakMultiplier
  const peakReadQps = avgReadQps * inp.peakMultiplier
  const peakTotalQps = avgTotalQps * inp.peakMultiplier

  // ── Payload sizes (bytes, SI units) ──
  const mediaShare = inp.mediaPercent / 100
  // Average size of one request once the media mix is blended in.
  const avgTransferBytes = (inp.payloadKB + mediaShare * inp.mediaSizeKB) * 1e3

  // ── Storage ──
  const ingestPerDayBytes = writesPerDay * avgTransferBytes
  const ingestRateBytesPerSec = ingestPerDayBytes / SECONDS_PER_DAY
  const storagePerYearBytes = ingestPerDayBytes * DAYS_PER_YEAR
  const overheadFactor = 1 + inp.overheadPercent / 100
  const rawRetainedBytes = storagePerYearBytes * inp.retentionYears * overheadFactor
  const replicatedRetainedBytes = rawRetainedBytes * inp.replicationFactor
  // Fixed 5-year figure so users can compare scenarios on equal footing.
  const fiveYearReplicatedBytes =
    storagePerYearBytes * 5 * overheadFactor * inp.replicationFactor

  // ── Cache (80/20 working set) ──
  const dailyReadVolumeBytes = readsPerDay * avgTransferBytes
  const cacheBytes = dailyReadVolumeBytes * (inp.cachePercent / 100)
  const usableRamPerNodeBytes = CACHE_NODE_RAM_GB * 1e9 * CACHE_NODE_USABLE_FRACTION
  const cacheNodes = cacheBytes > 0 ? Math.ceil(cacheBytes / usableRamPerNodeBytes) : 0

  // ── Bandwidth (bits per second at peak) ──
  const ingressBps = peakWriteQps * avgTransferBytes * 8
  const egressBps = peakReadQps * avgTransferBytes * 8

  // ── Hardware ──
  const effectiveQpsPerServer = inp.qpsPerServer * (inp.utilizationPercent / 100)
  const appServers =
    peakTotalQps > 0 && effectiveQpsPerServer > 0
      ? Math.ceil(peakTotalQps / effectiveQpsPerServer)
      : 0
  const shardBytes = inp.storagePerShardTB * 1e12
  const dbShards =
    rawRetainedBytes > 0 && shardBytes > 0 ? Math.ceil(rawRetainedBytes / shardBytes) : 0

  return {
    inputs: inp,
    requestsPerDay,
    writesPerDay,
    readsPerDay,
    avgWriteQps,
    avgReadQps,
    avgTotalQps,
    peakWriteQps,
    peakReadQps,
    peakTotalQps,
    avgTransferBytes,
    ingestPerDayBytes,
    ingestRateBytesPerSec,
    storagePerYearBytes,
    rawRetainedBytes,
    replicatedRetainedBytes,
    fiveYearReplicatedBytes,
    dailyReadVolumeBytes,
    cacheBytes,
    cacheNodes,
    ingressBps,
    egressBps,
    appServers,
    dbShards,
  }
}

/* ════════════════════════════════════════════════════════════════
   Formatting — 3 significant figures, unit ladders
   ════════════════════════════════════════════════════════════════ */

function toPrecision3(value) {
  if (value === 0) return '0'
  const rounded = Number(value.toPrecision(3))
  // Avoid scientific notation for the magnitudes we show (always < 1000 after scaling)
  return rounded >= 100
    ? String(Math.round(rounded))
    : String(rounded)
}

function scale(value, ladder, baseUnit) {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return `0 ${baseUnit}`
  const abs = Math.abs(value)
  let chosen = { factor: 1, unit: baseUnit }
  for (const step of ladder) {
    if (abs >= step.factor) chosen = step
  }
  return `${toPrecision3(value / chosen.factor)} ${chosen.unit}`
}

const COUNT_LADDER = [
  { factor: 1e3, unit: 'K' },
  { factor: 1e6, unit: 'M' },
  { factor: 1e9, unit: 'B' },
  { factor: 1e12, unit: 'T' },
]

const BYTE_LADDER = [
  { factor: 1e3, unit: 'KB' },
  { factor: 1e6, unit: 'MB' },
  { factor: 1e9, unit: 'GB' },
  { factor: 1e12, unit: 'TB' },
  { factor: 1e15, unit: 'PB' },
  { factor: 1e18, unit: 'EB' },
]

const BITRATE_LADDER = [
  { factor: 1e3, unit: 'Kbps' },
  { factor: 1e6, unit: 'Mbps' },
  { factor: 1e9, unit: 'Gbps' },
  { factor: 1e12, unit: 'Tbps' },
]

/** 12345678 → "12.3M" (no unit suffix beyond the magnitude letter). */
export function formatCount(value) {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return '0'
  const abs = Math.abs(value)
  if (abs < 1e3) return toPrecision3(value)
  let chosen = COUNT_LADDER[0]
  for (const step of COUNT_LADDER) {
    if (abs >= step.factor) chosen = step
  }
  return `${toPrecision3(value / chosen.factor)}${chosen.unit}`
}

/** Bytes → "1.23 TB" (SI decimal units). */
export function formatBytes(value) {
  return scale(value, BYTE_LADDER, 'B')
}

/** Bytes/second → "12.3 MB/s". */
export function formatBytesPerSec(value) {
  const text = scale(value, BYTE_LADDER, 'B')
  return text === '—' ? text : `${text}/s`
}

/** Bits/second → "1.52 Gbps". */
export function formatBitrate(value) {
  return scale(value, BITRATE_LADDER, 'bps')
}

/** QPS → "1.16K QPS". */
export function formatQps(value) {
  if (!Number.isFinite(value)) return '—'
  return `${formatCount(value)} QPS`
}

/** Nanoseconds → human latency string ("0.5 ns", "10 µs", "150 ms", "1.2 s"). */
export function formatLatency(ns) {
  if (!Number.isFinite(ns)) return '—'
  if (ns === 0) return '0 ns'
  if (ns < 1e3) return `${toPrecision3(ns)} ns`
  if (ns < 1e6) return `${toPrecision3(ns / 1e3)} µs`
  if (ns < 1e9) return `${toPrecision3(ns / 1e6)} ms`
  return `${toPrecision3(ns / 1e9)} s`
}

/* ════════════════════════════════════════════════════════════════
   Latency reference — "Numbers Every Engineer Should Know"
   Canonical Dean/Norvig table plus modern network figures.
   ════════════════════════════════════════════════════════════════ */

export const LATENCY_NUMBERS = [
  { id: 'l1-cache', label: 'L1 cache reference', ns: 0.5, tier: 'cpu' },
  { id: 'branch-mispredict', label: 'Branch mispredict', ns: 5, tier: 'cpu' },
  { id: 'l2-cache', label: 'L2 cache reference', ns: 7, tier: 'cpu' },
  { id: 'mutex', label: 'Mutex lock / unlock', ns: 25, tier: 'cpu' },
  { id: 'ram-ref', label: 'Main memory (RAM) reference', ns: 100, tier: 'memory' },
  { id: 'compress-1k', label: 'Compress 1 KB (Snappy)', ns: 3_000, tier: 'cpu' },
  { id: 'send-1k-net', label: 'Send 1 KB over 1 Gbps network', ns: 10_000, tier: 'network' },
  { id: 'nvme-read-4k', label: 'NVMe SSD random read (4 KB)', ns: 10_000, tier: 'disk' },
  { id: 'ram-read-1mb', label: 'Read 1 MB sequentially from RAM', ns: 250_000, tier: 'memory' },
  { id: 'dc-rtt', label: 'Round trip inside one datacenter', ns: 500_000, tier: 'network' },
  { id: 'ssd-read-1mb', label: 'Read 1 MB sequentially from SSD', ns: 1_000_000, tier: 'disk' },
  { id: 'az-rtt', label: 'Cross-AZ round trip (same region)', ns: 1_000_000, tier: 'network' },
  { id: 'hdd-seek', label: 'HDD disk seek', ns: 10_000_000, tier: 'disk' },
  { id: 'hdd-read-1mb', label: 'Read 1 MB sequentially from HDD', ns: 20_000_000, tier: 'disk' },
  { id: 'region-rtt', label: 'Cross-region RTT (US East ↔ US West)', ns: 65_000_000, tier: 'network' },
  { id: 'continent-rtt', label: 'Cross-continent RTT (CA ↔ Europe)', ns: 150_000_000, tier: 'network' },
]

/** Powers-of-two / handy constants table shown next to the latency sheet. */
export const POWERS_OF_TWO = [
  { power: 10, approx: '~1 thousand', exact: '1,024', unit: '1 KB' },
  { power: 20, approx: '~1 million', exact: '1,048,576', unit: '1 MB' },
  { power: 30, approx: '~1 billion', exact: '1.07 × 10⁹', unit: '1 GB' },
  { power: 40, approx: '~1 trillion', exact: '1.10 × 10¹²', unit: '1 TB' },
  { power: 50, approx: '~1 quadrillion', exact: '1.13 × 10¹⁵', unit: '1 PB' },
]

export const HANDY_CONSTANTS = [
  { label: 'Seconds per day', value: '86,400 ≈ 10⁵' },
  { label: 'Seconds per month', value: '~2.6 million' },
  { label: 'Requests/day per 1 avg QPS', value: '86,400' },
  { label: '1M requests/day', value: '≈ 11.6 QPS average' },
  { label: 'Days per year', value: '365 ≈ 3.15 × 10⁷ s' },
]

/**
 * Sum a latency budget (list of { id, count }) into total nanoseconds.
 * Unknown ids are ignored so stale saved budgets never crash.
 */
export function sumLatencyBudget(items = []) {
  let total = 0
  for (const item of items) {
    const ref = LATENCY_NUMBERS.find((l) => l.id === item.id)
    if (ref) total += ref.ns * Math.max(0, item.count || 0)
  }
  return total
}

/* ════════════════════════════════════════════════════════════════
   Scenario presets
   ════════════════════════════════════════════════════════════════ */

export const SCENARIOS = [
  {
    id: 'custom',
    name: 'Custom',
    emoji: '🎛️',
    description: 'Your own numbers, no preset assumptions.',
  },
  {
    id: 'url-shortener',
    name: 'URL Shortener',
    emoji: '🔗',
    description: 'Tiny payloads, extreme read skew, long retention.',
    inputs: {
      dau: 10_000_000, requestsPerUser: 2, readRatio: 100, peakMultiplier: 2,
      payloadKB: 0.5, mediaPercent: 0, mediaSizeKB: 0, retentionYears: 10,
      replicationFactor: 3, cachePercent: 20,
    },
  },
  {
    id: 'video-streaming',
    name: 'Video Streaming',
    emoji: '🎬',
    description: 'Huge media objects, CDN-dominated egress.',
    inputs: {
      dau: 50_000_000, requestsPerUser: 8, readRatio: 200, peakMultiplier: 2,
      payloadKB: 5, mediaPercent: 80, mediaSizeKB: 300_000, retentionYears: 5,
      replicationFactor: 3, cachePercent: 10,
    },
  },
  {
    id: 'flash-sale',
    name: 'E-Commerce Flash Sale',
    emoji: '⚡',
    description: 'Moderate scale but brutal peak multiplier and write contention.',
    inputs: {
      dau: 5_000_000, requestsPerUser: 20, readRatio: 20, peakMultiplier: 30,
      payloadKB: 4, mediaPercent: 30, mediaSizeKB: 200, retentionYears: 3,
      replicationFactor: 3, cachePercent: 30,
    },
  },
  {
    id: 'chat-app',
    name: 'Chat / Messaging',
    emoji: '💬',
    description: 'Write-heavy for consumer apps, fan-out on delivery.',
    inputs: {
      dau: 20_000_000, requestsPerUser: 40, readRatio: 4, peakMultiplier: 3,
      payloadKB: 1, mediaPercent: 5, mediaSizeKB: 800, retentionYears: 5,
      replicationFactor: 3, cachePercent: 20,
    },
  },
  {
    id: 'social-feed',
    name: 'Social Feed',
    emoji: '📱',
    description: 'Classic 100:1 read skew with mixed media.',
    inputs: {
      dau: 100_000_000, requestsPerUser: 30, readRatio: 100, peakMultiplier: 3,
      payloadKB: 2, mediaPercent: 20, mediaSizeKB: 400, retentionYears: 5,
      replicationFactor: 3, cachePercent: 20,
    },
  },
  {
    id: 'ride-sharing',
    name: 'Ride Sharing',
    emoji: '🚗',
    description: 'Constant location writes — near 1:1 read/write ratio.',
    inputs: {
      dau: 8_000_000, requestsPerUser: 120, readRatio: 1, peakMultiplier: 4,
      payloadKB: 0.3, mediaPercent: 0, mediaSizeKB: 0, retentionYears: 1,
      replicationFactor: 3, cachePercent: 40,
    },
  },
]

/* ════════════════════════════════════════════════════════════════
   Markdown export
   ════════════════════════════════════════════════════════════════ */

/**
 * Build the exportable Markdown summary (with LaTeX formulas).
 *
 * @param {Object} results - Return of computeEstimates()
 * @param {Object} [options]
 * @param {string} [options.scenarioName] - Selected scenario label
 * @param {Array}  [options.latencyBudget] - Budget items [{ id, count }]
 * @returns {string} Markdown document
 */
export function buildMarkdownSummary(results, { scenarioName, latencyBudget } = {}) {
  const i = results.inputs
  const lines = []
  lines.push(`## Back-of-the-Envelope Estimate${scenarioName && scenarioName !== 'Custom' ? ` — ${scenarioName}` : ''}`)
  lines.push('')
  lines.push('### Assumptions')
  lines.push('')
  lines.push('| Parameter | Value |')
  lines.push('|---|---|')
  lines.push(`| Daily Active Users | ${formatCount(i.dau)} |`)
  lines.push(`| Requests per user / day | ${formatCount(i.requestsPerUser)} |`)
  lines.push(`| Read : Write ratio | ${formatCount(i.readRatio)} : 1 |`)
  lines.push(`| Peak multiplier | ${i.peakMultiplier}× |`)
  lines.push(`| Avg payload | ${i.payloadKB} KB (+${i.mediaPercent}% media @ ${formatBytes(i.mediaSizeKB * 1e3)}) |`)
  lines.push(`| Retention × replication | ${i.retentionYears} yr × ${i.replicationFactor}× |`)
  if (i.overheadPercent > 0) lines.push(`| Index/metadata overhead | ${i.overheadPercent}% |`)
  lines.push('')
  lines.push('### Traffic')
  lines.push('')
  lines.push('$$QPS_{write} = \\frac{DAU \\times req/user}{86{,}400 \\times (R+1)}$$')
  lines.push('')
  lines.push(`- Average write QPS: **${formatCount(results.avgWriteQps)}**`)
  lines.push(`- Average read QPS: **${formatCount(results.avgReadQps)}**`)
  lines.push(`- Peak total QPS (${i.peakMultiplier}×): **${formatCount(results.peakTotalQps)}**`)
  lines.push('')
  lines.push('### Storage')
  lines.push('')
  lines.push('$$S = W_{day} \\times size \\times 365 \\times years \\times RF \\times (1 + overhead)$$')
  lines.push('')
  lines.push(`- Ingestion rate: **${formatBytesPerSec(results.ingestRateBytesPerSec)}** (${formatBytes(results.ingestPerDayBytes)}/day)`)
  lines.push(`- Storage per year (raw): **${formatBytes(results.storagePerYearBytes)}**`)
  lines.push(`- ${i.retentionYears}-year total × ${i.replicationFactor} replicas: **${formatBytes(results.replicatedRetainedBytes)}**`)
  lines.push('')
  lines.push('### Cache & Memory')
  lines.push('')
  lines.push(`$$Cache = ${i.cachePercent}\\% \\times reads_{day} \\times size$$`)
  lines.push('')
  lines.push(`- Working-set cache: **${formatBytes(results.cacheBytes)}** (~${results.cacheNodes} × ${CACHE_NODE_RAM_GB} GB nodes)`)
  lines.push('')
  lines.push('### Bandwidth (at peak)')
  lines.push('')
  lines.push(`- Ingress: **${formatBitrate(results.ingressBps)}**`)
  lines.push(`- Egress: **${formatBitrate(results.egressBps)}**`)
  lines.push('')
  lines.push('### Hardware')
  lines.push('')
  lines.push(`$$N = \\lceil QPS_{peak} \\div (QPS_{node} \\times ${i.utilizationPercent}\\%) \\rceil$$`)
  lines.push('')
  lines.push(`- App servers: **~${formatCount(results.appServers)}** (${formatCount(i.qpsPerServer)} QPS/node @ ${i.utilizationPercent}%)`)
  lines.push(`- DB shards: **~${formatCount(results.dbShards)}** (${i.storagePerShardTB} TB/shard)`)

  if (latencyBudget && latencyBudget.length > 0) {
    lines.push('')
    lines.push('### Latency Budget')
    lines.push('')
    for (const item of latencyBudget) {
      const ref = LATENCY_NUMBERS.find((l) => l.id === item.id)
      if (!ref) continue
      lines.push(`- ${item.count} × ${ref.label} = ${formatLatency(ref.ns * item.count)}`)
    }
    lines.push(`- **Total ≈ ${formatLatency(sumLatencyBudget(latencyBudget))}**`)
  }

  lines.push('')
  lines.push('> Generated with the Toolbox BotE Calculator')
  return lines.join('\n')
}
