
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
