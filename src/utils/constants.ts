interface PillarTopicDef {
  id: string
  name: string
}

interface PillarDef {
  id: string
  number: number
  name: string
  shortName: string
  color: string
  topics: PillarTopicDef[]
}

interface BlueprintSectionDef {
  id: string
  name: string
  icon: string
}

interface BuilderComponentItem {
  id: string
  name: string
  icon: string
}

interface BuilderComponentCategory {
  category: string
  color: string
  items: BuilderComponentItem[]
}

/**
 * Pillar definitions — baseline System Design skeleton constants.
 */
export const PILLARS: PillarDef[] = [
  {
    id: 'compute',
    number: 1,
    name: 'Compute & Infrastructure',
    shortName: 'Compute',
    color: '#818cf8',
    topics: [
      { id: 'traffic-gateways', name: 'Traffic Gateways & Proxies' },
      { id: 'stateless-compute', name: 'Stateless Compute Workers' },
      { id: 'message-brokers', name: 'Async Message Brokers' },
      { id: 'stream-processors', name: 'Stateful Stream Processors' },
      { id: 'batch-processing', name: 'Batch Processing & MapReduce' },
      { id: 'edge-cdn', name: 'Edge Layer & CDN' },
    ],
  },
  {
    id: 'data-storage',
    number: 2,
    name: 'Data Storage & State',
    shortName: 'Storage',
    color: '#34d399',
    topics: [
      { id: 'relational-oltp', name: 'Relational Databases (OLTP)' },
      { id: 'analytical-olap', name: 'Analytical Databases (OLAP)' },
      { id: 'kv-stores', name: 'Key-Value / In-Memory Stores' },
      { id: 'caching-strategies', name: 'Caching Strategies & Invalidation' },
      { id: 'object-blob-storage', name: 'Object & Blob Storage' },
      { id: 'full-text-search', name: 'Full-Text Search (Inverted Indexes)' },
      { id: 'vector-indexes', name: 'Vector & Semantic Indexes' },
      { id: 'state-engines', name: 'Durable State Engines' },
    ],
  },
  {
    id: 'network-protocols',
    number: 3,
    name: 'Network & API Protocols',
    shortName: 'Protocols',
    color: '#60a5fa',
    topics: [
      { id: 'request-response', name: 'Request-Response Protocols' },
      { id: 'streaming', name: 'Persistent & Duplex Streaming' },
      { id: 'binary-serialization', name: 'Binary Serialization Formats' },
      { id: 'agentic-contracts', name: 'Agentic Tool Contracts' },
    ],
  },
  {
    id: 'observability',
    number: 4,
    name: 'Observability',
    shortName: 'Observability',
    color: '#fbbf24',
    topics: [
      { id: 'telemetry', name: 'Telemetry Pipelines' },
      { id: 'hitl-gateways', name: 'Human-In-The-Loop Gateways' },
      { id: 'eval-frameworks', name: 'Evaluation Frameworks' },
    ],
  },
  {
    id: 'resiliency',
    number: 5,
    name: 'Resiliency & Traffic Control',
    shortName: 'Resiliency',
    color: '#f97316',
    topics: [
      { id: 'circuit-breakers', name: 'Circuit Breakers' },
      { id: 'rate-limiters-load-shedding', name: 'Rate Limiters & Load Shedding' },
      { id: 'retries-backoff', name: 'Retries, Timeouts & Backoff' },
    ],
  },
  {
    id: 'distributed-mechanics',
    number: 6,
    name: 'Distributed Data Mechanics',
    shortName: 'Distributed',
    color: '#a78bfa',
    topics: [
      { id: 'partitioning-sharding', name: 'Partitioning & Sharding' },
      { id: 'replication-strategies', name: 'Replication Strategies' },
      { id: 'consistency-models', name: 'Consistency Models (CAP/PACELC)' },
      { id: 'consensus-coordination', name: 'Consensus & Coordination' },
    ],
  },
  {
    id: 'paradigms',
    number: 7,
    name: 'Architectural Paradigms',
    shortName: 'Paradigms',
    color: '#f472b6',
    topics: [
      { id: 'heavy-write', name: 'Heavy-Write Ingestion Pipeline' },
      { id: 'heavy-read', name: 'Heavy-Read Fan-Out' },
      { id: 'spatial-grid', name: 'Real-Time Spatial Grid' },
      { id: 'multi-agent', name: 'Multi-Agent Blackboard' },
    ],
  },
]

const STANDARD_COG_SECTIONS: BlueprintSectionDef[] = [
  { id: 'description', name: 'Description & Internal Workings', icon: 'cpu' },
  { id: 'usecases', name: 'Use Cases & Tradeoffs', icon: 'scale' },
  { id: 'scaling', name: 'Scaling Estimates & Mechanisms', icon: 'trending-up' },
  { id: 'availability', name: 'Availability & Reliability', icon: 'shield' },
  { id: 'failure-modes', name: 'Failure Modes & Blast Radius', icon: 'alert-triangle' },
  { id: 'cost-vectors', name: 'Cost Vectors at Scale', icon: 'dollar-sign' },
  { id: 'deployment', name: 'Deployment & APIs', icon: 'box' },
]

const RESILIENCY_SECTIONS: BlueprintSectionDef[] = [
  { id: 'description', name: 'Description & Internal Workings', icon: 'cpu' },
  { id: 'usecases', name: 'When to Deploy & Anti-Patterns', icon: 'scale' },
  { id: 'configuration', name: 'Configuration & Tuning', icon: 'sliders-horizontal' },
  { id: 'failure-modes', name: 'Failure Modes & Blast Radius', icon: 'alert-triangle' },
  { id: 'cost-vectors', name: 'Cost Vectors at Scale', icon: 'dollar-sign' },
]

const DISTRIBUTED_SECTIONS: BlueprintSectionDef[] = [
  { id: 'concept', name: 'Concept & Mental Model', icon: 'cpu' },
  { id: 'strategies', name: 'Strategies & Algorithms', icon: 'link' },
  { id: 'tradeoffs', name: 'Tradeoffs & CAP Implications', icon: 'scale' },
  { id: 'interview-angles', name: 'Interview Angles & Gotchas', icon: 'target' },
]

export const BLUEPRINT_SECTIONS: Record<string, BlueprintSectionDef[]> = {
  compute: STANDARD_COG_SECTIONS,
  'data-storage': STANDARD_COG_SECTIONS,
  'network-protocols': [
    { id: 'protocol', name: 'Protocol Description & Types', icon: 'radio' },
    { id: 'usecases', name: 'Ideal Use Cases & Anti-Patterns', icon: 'target' },
    { id: 'components', name: 'Associated Components', icon: 'link' },
    { id: 'tradeoffs', name: 'Comparative Tradeoffs', icon: 'scale' },
  ],
  observability: STANDARD_COG_SECTIONS,
  resiliency: RESILIENCY_SECTIONS,
  'distributed-mechanics': DISTRIBUTED_SECTIONS,
  paradigms: [
    { id: 'core-goal', name: 'Core Goal & Analysis', icon: 'target' },
    { id: 'components', name: 'Required Components & API Binding', icon: 'puzzle' },
    { id: 'adjustments', name: 'Product Adjustments & Tuning', icon: 'sliders-horizontal' },
  ],
}

export const BUILDER_COMPONENTS: BuilderComponentCategory[] = [
  {
    category: 'Compute',
    color: '#818cf8',
    items: [
      { id: 'load-balancer', name: 'Load Balancer', icon: 'split' },
      { id: 'api-gateway', name: 'API Gateway', icon: 'door-open' },
      { id: 'microservice', name: 'Microservice', icon: 'box' },
      { id: 'serverless-fn', name: 'Serverless Function', icon: 'zap' },
      { id: 'worker', name: 'Background Worker', icon: 'cog' },
      { id: 'message-queue', name: 'Message Queue', icon: 'mail' },
      { id: 'event-bus', name: 'Event Bus', icon: 'radio' },
      { id: 'stream-processor', name: 'Stream Processor', icon: 'activity' },
      { id: 'batch-processor', name: 'Batch Processor', icon: 'layers' },
      { id: 'cdn', name: 'CDN / Edge Node', icon: 'globe' },
    ],
  },
  {
    category: 'Storage',
    color: '#34d399',
    items: [
      { id: 'sql-db', name: 'SQL Database', icon: 'database' },
      { id: 'nosql-db', name: 'NoSQL Database', icon: 'hard-drive' },
      { id: 'cache', name: 'Cache (Redis)', icon: 'zap' },
      { id: 'object-storage', name: 'Object Storage (S3/GCS)', icon: 'archive' },
      { id: 'search-index', name: 'Full-Text Search (ES)', icon: 'search' },
      { id: 'vector-db', name: 'Vector Database', icon: 'brain' },
    ],
  },
  {
    category: 'Clients',
    color: '#60a5fa',
    items: [
      { id: 'web-client', name: 'Web Client', icon: 'monitor' },
      { id: 'mobile-client', name: 'Mobile Client', icon: 'smartphone' },
      { id: 'iot-device', name: 'IoT Device', icon: 'cpu' },
      { id: 'third-party', name: '3rd Party Service', icon: 'external-link' },
    ],
  },
  {
    category: 'Resiliency',
    color: '#f97316',
    items: [
      { id: 'rate-limiter', name: 'Rate Limiter', icon: 'shield' },
      { id: 'circuit-breaker', name: 'Circuit Breaker', icon: 'alert-triangle' },
      { id: 'retry-handler', name: 'Retry / Backoff Handler', icon: 'refresh-cw' },
      { id: 'load-shedder', name: 'Load Shedder', icon: 'filter' },
    ],
  },
  {
    category: 'Observability',
    color: '#fbbf24',
    items: [
      { id: 'logger', name: 'Log Aggregator', icon: 'file-text' },
      { id: 'metrics', name: 'Metrics Collector', icon: 'bar-chart' },
      { id: 'tracer', name: 'Distributed Tracer', icon: 'git-branch' },
    ],
  },
]
