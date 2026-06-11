/**
 * Pillar definitions — structure only, content will be populated later.
 * Each pillar has an id, name, icon color, and a list of topics.
 */
export const PILLARS = [
  {
    id: 'compute',
    number: 1,
    name: 'Compute & Infrastructure',
    shortName: 'Compute',
    color: '#818cf8', // indigo
    topics: [
      { id: 'traffic-gateways', name: 'Traffic Gateways & Proxies' },
      { id: 'stateless-compute', name: 'Stateless Compute Workers' },
      { id: 'message-brokers', name: 'Async Message Brokers' },
      { id: 'stream-processors', name: 'Stateful Stream Processors' },
    ],
  },
  {
    id: 'data-storage',
    number: 2,
    name: 'Data Storage & State',
    shortName: 'Storage',
    color: '#34d399', // emerald
    topics: [
      { id: 'relational-oltp', name: 'Relational Databases (OLTP)' },
      { id: 'analytical-olap', name: 'Analytical Databases (OLAP)' },
      { id: 'kv-stores', name: 'Key-Value / In-Memory Stores' },
      { id: 'vector-indexes', name: 'Vector & Semantic Indexes' },
      { id: 'state-engines', name: 'Durable State Engines' },
    ],
  },
  {
    id: 'network-protocols',
    number: 3,
    name: 'Network & API Protocols',
    shortName: 'Protocols',
    color: '#60a5fa', // blue
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
    name: 'Observability & Safety',
    shortName: 'Observability',
    color: '#fbbf24', // amber
    topics: [
      { id: 'telemetry', name: 'Telemetry Pipelines' },
      { id: 'circuit-breakers', name: 'Circuit Breakers & Rate Limiters' },
      { id: 'hitl-gateways', name: 'Human-In-The-Loop Gateways' },
      { id: 'eval-frameworks', name: 'Evaluation Frameworks' },
    ],
  },
  {
    id: 'paradigms',
    number: 5,
    name: 'Architectural Paradigms',
    shortName: 'Paradigms',
    color: '#f472b6', // pink
    topics: [
      { id: 'heavy-write', name: 'Heavy-Write Ingestion Pipeline' },
      { id: 'heavy-read', name: 'Heavy-Read Fan-Out' },
      { id: 'spatial-grid', name: 'Real-Time Spatial Grid' },
      { id: 'multi-agent', name: 'Multi-Agent Blackboard' },
    ],
  },
]

/**
 * Blueprint sections — the 5 study dimensions for each component.
 * Content for each will come from the data layer.
 */
export const BLUEPRINT_SECTIONS = {
  compute: [
    { id: 'description', name: 'Description & Internal Workings', icon: 'cpu' },
    { id: 'usecases', name: 'Use Cases & Tradeoffs', icon: 'scale' },
    { id: 'scaling', name: 'Scaling Estimates & Mechanisms', icon: 'trending-up' },
    { id: 'availability', name: 'Availability & Reliability', icon: 'shield' },
    { id: 'deployment', name: 'Deployment & APIs', icon: 'box' },
  ],
  'data-storage': [
    { id: 'description', name: 'Description & Internal Workings', icon: 'cpu' },
    { id: 'usecases', name: 'Use Cases & Tradeoffs', icon: 'scale' },
    { id: 'scaling', name: 'Scaling Estimates & Mechanisms', icon: 'trending-up' },
    { id: 'availability', name: 'Availability & Reliability', icon: 'shield' },
    { id: 'deployment', name: 'Deployment & APIs', icon: 'box' },
  ],
  'network-protocols': [
    { id: 'protocol', name: 'Protocol Description & Types', icon: 'radio' },
    { id: 'usecases', name: 'Ideal Use Cases & Anti-Patterns', icon: 'target' },
    { id: 'components', name: 'Associated Components', icon: 'link' },
    { id: 'tradeoffs', name: 'Comparative Tradeoffs', icon: 'scale' },
  ],
  observability: [
    { id: 'description', name: 'Description & Internal Workings', icon: 'cpu' },
    { id: 'usecases', name: 'Use Cases & Tradeoffs', icon: 'scale' },
    { id: 'scaling', name: 'Scaling Estimates & Mechanisms', icon: 'trending-up' },
    { id: 'availability', name: 'Availability & Reliability', icon: 'shield' },
    { id: 'deployment', name: 'Deployment & APIs', icon: 'box' },
  ],
  paradigms: [
    { id: 'core-goal', name: 'Core Goal & Analysis', icon: 'target' },
    { id: 'components', name: 'Required Components & API Binding', icon: 'puzzle' },
    { id: 'adjustments', name: 'Product Adjustments & Tuning', icon: 'sliders-horizontal' },
  ],
}

/**
 * Builder component categories for the toolbox palette.
 */
export const BUILDER_COMPONENTS = [
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
    ],
  },
  {
    category: 'Storage',
    color: '#34d399',
    items: [
      { id: 'sql-db', name: 'SQL Database', icon: 'database' },
      { id: 'nosql-db', name: 'NoSQL Database', icon: 'hard-drive' },
      { id: 'cache', name: 'Cache (Redis)', icon: 'zap' },
      { id: 'object-storage', name: 'Object Storage', icon: 'archive' },
      { id: 'search-index', name: 'Search Index', icon: 'search' },
      { id: 'vector-db', name: 'Vector Database', icon: 'brain' },
      { id: 'cdn', name: 'CDN', icon: 'globe' },
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
    category: 'Observability',
    color: '#fbbf24',
    items: [
      { id: 'rate-limiter', name: 'Rate Limiter', icon: 'shield' },
      { id: 'circuit-breaker', name: 'Circuit Breaker', icon: 'alert-triangle' },
      { id: 'logger', name: 'Log Aggregator', icon: 'file-text' },
      { id: 'metrics', name: 'Metrics Collector', icon: 'bar-chart' },
    ],
  },
]

/**
 * Protocol types available in builder connections.
 */
export const CONNECTION_PROTOCOLS = [
  { id: 'http', name: 'HTTP/REST', color: '#60a5fa' },
  { id: 'grpc', name: 'gRPC', color: '#818cf8' },
  { id: 'websocket', name: 'WebSocket', color: '#34d399' },
  { id: 'tcp', name: 'TCP/UDP', color: '#fbbf24' },
  { id: 'pubsub', name: 'Pub/Sub', color: '#f472b6' },
]
