/**
 * @fileoverview The system design Knowledge Graph.
 *
 * Nodes are concepts. Edges are directed prerequisite dependencies:
 * an edge `{ from: A, to: B }` means "learn A before B".
 *
 * The ordering follows the standard learning progression used by the
 * major interview-prep curricula (DDIA chapter order, roadmap-style
 * fundamentals → building blocks → distributed theory):
 *   1. Fundamentals: client-server, HTTP, SQL, hashing, latency math
 *   2. Building blocks: load balancing, caching, indexes, queues, CDN
 *   3. Distributed mechanics: replication, partitioning, CAP, quorums
 *   4. Advanced: consensus, distributed KV stores, transactions
 *   5. Paradigms: full architectures that compose everything below
 *
 * This module is pure data + pure functions. It is imported by BOTH the
 * client (graph visualizer) and the server (health + remediation engine),
 * so keep it free of React and Node dependencies.
 *
 * Every node:
 *   id        - stable slug (used in URLs and the remediation queue)
 *   name      - display name
 *   pillarId  - one of the 7 pillars in constants.js (grouping + color)
 *   topicId   - guide topic for deep-linking (null = graph-only concept)
 *   keywords  - lowercase phrases that link flashcards to this node.
 *               Multi-word phrases preferred — they keep matching precise.
 *   components- builder component ids, to find related whiteboards
 *   summary   - one-liner shown in the node panel
 */

export const GRAPH_NODES = [
  // ── Fundamentals ──────────────────────────────────────────────
  {
    id: 'client-server', name: 'Client-Server Model', pillarId: 'network-protocols',
    topicId: 'request-response',
    keywords: ['client-server', 'client server model', 'request-response', 'request response cycle'],
    components: ['web-client', 'mobile-client'],
    summary: 'Clients send requests; servers answer them. The base pattern every other concept builds on.',
  },
  {
    id: 'latency-throughput', name: 'Latency vs Throughput', pillarId: 'distributed-mechanics',
    topicId: null,
    keywords: ['latency vs throughput', 'p99', 'p95', 'tail latency', 'percentile latency', 'throughput'],
    components: [],
    summary: 'Latency is time per request; throughput is requests per time. Optimizing one often costs the other.',
  },
  {
    id: 'capacity-estimation', name: 'Capacity Estimation (BotE)', pillarId: 'distributed-mechanics',
    topicId: null,
    keywords: ['back of the envelope', 'capacity estimation', 'qps estimate', 'estimation'],
    components: [],
    summary: 'Sizing traffic, storage, cache, and hardware from first principles. Practice in the Calculator.',
  },
  {
    id: 'scalability-basics', name: 'Vertical vs Horizontal Scaling', pillarId: 'compute',
    topicId: 'stateless-compute',
    keywords: ['horizontal scaling', 'vertical scaling', 'scale out', 'scale up'],
    components: [],
    summary: 'Bigger machines vs more machines — and why the web picked "more machines".',
  },
  {
    id: 'availability-slos', name: 'Availability, SLOs & Nines', pillarId: 'resiliency',
    topicId: null,
    keywords: ['availability', 'sla', 'slo', 'five nines', 'error budget', 'uptime'],
    components: [],
    summary: 'How reliability is measured (99.9% vs 99.999%) and promised (SLAs, error budgets).',
  },
  {
    id: 'http-rest', name: 'HTTP & REST APIs', pillarId: 'network-protocols',
    topicId: 'request-response',
    keywords: ['http', 'rest api', 'restful', 'status code', 'idempotent method'],
    components: [],
    summary: 'The lingua franca of services: verbs, status codes, headers, statelessness.',
  },
  {
    id: 'dns', name: 'DNS & Service Discovery', pillarId: 'network-protocols',
    topicId: 'request-response',
    keywords: ['dns', 'domain name system', 'service discovery', 'name resolution'],
    components: [],
    summary: 'Turning names into addresses — the first hop of every request.',
  },
  {
    id: 'sql-basics', name: 'Relational Modeling & SQL', pillarId: 'data-storage',
    topicId: 'relational-oltp',
    keywords: ['relational database', 'sql', 'normalization', 'foreign key', 'schema design', 'postgres', 'mysql'],
    components: ['sql-db'],
    summary: 'Tables, joins, and normalization — the default data home until scale forces trade-offs.',
  },
  {
    id: 'hashing-fundamentals', name: 'Hash Functions & Key Distribution', pillarId: 'distributed-mechanics',
    topicId: 'partitioning-sharding',
    keywords: ['hash function', 'hash key', 'modulo hashing', 'uniform distribution'],
    components: [],
    summary: 'Deterministic key → bucket mapping. The primitive behind sharding and consistent hashing.',
  },

  // ── Building blocks ───────────────────────────────────────────
  {
    id: 'load-balancing', name: 'Load Balancing', pillarId: 'compute',
    topicId: 'traffic-gateways',
    keywords: ['load balancer', 'load balancing', 'round robin', 'least connections', 'l4 vs l7', 'health check'],
    components: ['load-balancer'],
    summary: 'Spreading traffic across replicas: algorithms, health checks, L4 vs L7.',
  },
  {
    id: 'reverse-proxy', name: 'Reverse Proxies & API Gateways', pillarId: 'compute',
    topicId: 'traffic-gateways',
    keywords: ['reverse proxy', 'api gateway', 'forward proxy', 'tls termination', 'ingress'],
    components: ['api-gateway'],
    summary: 'The front door: routing, TLS termination, auth, and cross-cutting policies.',
  },
  {
    id: 'stateless-services', name: 'Stateless Services & Sessions', pillarId: 'compute',
    topicId: 'stateless-compute',
    keywords: ['stateless service', 'session affinity', 'sticky session', 'externalized state', 'microservice'],
    components: ['microservice'],
    summary: 'Push state out of app servers so any replica can serve any request.',
  },
  {
    id: 'serverless', name: 'Serverless & FaaS', pillarId: 'compute',
    topicId: 'stateless-compute',
    keywords: ['serverless', 'lambda', 'faas', 'cold start'],
    components: ['serverless-fn'],
    summary: 'Functions that scale to zero — and the cold-start / state trade-offs that come with them.',
  },
  {
    id: 'db-indexing', name: 'Database Indexing & B-Trees', pillarId: 'data-storage',
    topicId: 'relational-oltp',
    keywords: ['b-tree', 'btree', 'database index', 'composite index', 'covering index', 'index scan'],
    components: [],
    summary: 'Why reads get fast and writes pay for it: B-trees, composite keys, covering indexes.',
  },
  {
    id: 'transactions-acid', name: 'Transactions & ACID', pillarId: 'data-storage',
    topicId: 'relational-oltp',
    keywords: ['acid', 'transaction isolation', 'serializable', 'two-phase locking', 'mvcc', 'write skew'],
    components: [],
    summary: 'Atomicity and isolation levels — what the database really guarantees.',
  },
  {
    id: 'caching-fundamentals', name: 'Caching Fundamentals', pillarId: 'data-storage',
    topicId: 'caching-strategies',
    keywords: ['cache hit', 'cache miss', 'hit ratio', 'working set', '80/20 rule', 'hot key'],
    components: ['cache'],
    summary: 'The 80/20 working set: serve hot data from memory, protect the database.',
  },
  {
    id: 'cache-strategies', name: 'Cache Writing & Eviction', pillarId: 'data-storage',
    topicId: 'caching-strategies',
    keywords: ['cache-aside', 'cache aside', 'write-through', 'write-behind', 'write-back', 'lru', 'lfu', 'ttl eviction'],
    components: ['cache'],
    summary: 'Cache-aside vs write-through vs write-behind, plus LRU/LFU eviction.',
  },
  {
    id: 'cache-invalidation', name: 'Cache Invalidation & Stampedes', pillarId: 'data-storage',
    topicId: 'caching-strategies',
    keywords: ['cache invalidation', 'cache stampede', 'thundering herd', 'stale cache', 'cache coherence', 'dogpile'],
    components: ['cache'],
    summary: 'One of the two hard problems: staleness, stampedes, and the thundering herd.',
  },
  {
    id: 'cdn', name: 'CDN & Edge Caching', pillarId: 'compute',
    topicId: 'edge-cdn',
    keywords: ['cdn', 'edge cache', 'content delivery network', 'point of presence', 'edge node', 'cache-control'],
    components: ['cdn'],
    summary: 'Push static and cacheable content to the edge, next to users.',
  },
  {
    id: 'object-storage', name: 'Object & Blob Storage', pillarId: 'data-storage',
    topicId: 'object-blob-storage',
    keywords: ['object storage', 'blob storage', 's3', 'presigned url', 'multipart upload'],
    components: ['object-storage'],
    summary: 'Cheap, durable, flat-namespace storage for media and backups.',
  },
  {
    id: 'nosql-types', name: 'NoSQL Data Models', pillarId: 'data-storage',
    topicId: 'kv-stores',
    keywords: ['nosql', 'document store', 'wide column', 'key-value store', 'denormalization', 'mongodb', 'cassandra'],
    components: ['nosql-db'],
    summary: 'Key-value, document, wide-column, graph — trading query power for scale.',
  },
  {
    id: 'message-queues', name: 'Message Queues & Async Work', pillarId: 'compute',
    topicId: 'message-brokers',
    keywords: ['message queue', 'task queue', 'dead letter', 'at-least-once', 'consumer group', 'sqs', 'rabbitmq'],
    components: ['message-queue', 'worker'],
    summary: 'Decouple producers from consumers; absorb bursts; retry safely.',
  },
  {
    id: 'pubsub-logs', name: 'Pub/Sub & Event Logs', pillarId: 'compute',
    topicId: 'message-brokers',
    keywords: ['pub/sub', 'pubsub', 'kafka', 'event log', 'log compaction', 'partition offset', 'event-driven'],
    components: ['event-bus'],
    summary: 'Durable, replayable event streams (Kafka-style) vs fire-and-forget queues.',
  },
  {
    id: 'websockets-streaming', name: 'WebSockets & Realtime Push', pillarId: 'network-protocols',
    topicId: 'streaming',
    keywords: ['websocket', 'long polling', 'server-sent events', 'sse', 'realtime push', 'duplex'],
    components: [],
    summary: 'Keeping a connection open: long polling → SSE → WebSockets.',
  },
  {
    id: 'grpc-serialization', name: 'gRPC & Binary Serialization', pillarId: 'network-protocols',
    topicId: 'binary-serialization',
    keywords: ['grpc', 'protobuf', 'protocol buffers', 'avro', 'thrift', 'schema evolution', 'binary serialization'],
    components: [],
    summary: 'Compact typed wire formats and schema evolution for service-to-service calls.',
  },
  {
    id: 'agentic-tools', name: 'Agentic Tool Contracts', pillarId: 'network-protocols',
    topicId: 'agentic-contracts',
    keywords: ['tool calling', 'function calling', 'mcp', 'agent contract', 'tool schema'],
    components: [],
    summary: 'Typed contracts that let LLM agents call systems safely.',
  },
  {
    id: 'rate-limiting', name: 'Rate Limiting Algorithms', pillarId: 'resiliency',
    topicId: 'rate-limiters-load-shedding',
    keywords: ['rate limit', 'token bucket', 'leaky bucket', 'sliding window', 'throttling', '429'],
    components: ['rate-limiter'],
    summary: 'Token bucket, leaky bucket, sliding windows — protecting systems from abuse and bursts.',
  },
  {
    id: 'timeouts-retries', name: 'Timeouts, Retries & Backoff', pillarId: 'resiliency',
    topicId: 'retries-backoff',
    keywords: ['exponential backoff', 'retry storm', 'jitter', 'timeout budget', 'deadline propagation'],
    components: ['retry-handler'],
    summary: 'Exponential backoff with jitter — and why naive retries melt systems.',
  },
  {
    id: 'circuit-breakers', name: 'Circuit Breakers & Bulkheads', pillarId: 'resiliency',
    topicId: 'circuit-breakers',
    keywords: ['circuit breaker', 'bulkhead', 'half-open', 'fail fast', 'cascading failure'],
    components: ['circuit-breaker'],
    summary: 'Fail fast when a dependency is down; contain the blast radius.',
  },
  {
    id: 'load-shedding', name: 'Load Shedding & Backpressure', pillarId: 'resiliency',
    topicId: 'rate-limiters-load-shedding',
    keywords: ['load shedding', 'backpressure', 'admission control', 'graceful degradation', 'priority queue drop'],
    components: ['load-shedder'],
    summary: 'When overloaded, drop cheap work early instead of failing everything late.',
  },
  {
    id: 'idempotency', name: 'Idempotency & Delivery Semantics', pillarId: 'distributed-mechanics',
    topicId: null,
    keywords: ['idempotency key', 'idempotent', 'exactly-once', 'at-least-once delivery', 'deduplication'],
    components: [],
    summary: 'Making retries safe: idempotency keys and the myth of exactly-once.',
  },
  {
    id: 'metrics-logs', name: 'Metrics, Logs & Alerting', pillarId: 'observability',
    topicId: 'telemetry',
    keywords: ['metrics', 'structured logging', 'alerting', 'golden signals', 'prometheus', 'log aggregation'],
    components: ['logger', 'metrics'],
    summary: 'The golden signals: latency, traffic, errors, saturation.',
  },
  {
    id: 'distributed-tracing', name: 'Distributed Tracing', pillarId: 'observability',
    topicId: 'telemetry',
    keywords: ['distributed tracing', 'trace id', 'span', 'opentelemetry', 'correlation id'],
    components: ['tracer'],
    summary: 'Following one request across a dozen services with trace/span IDs.',
  },
  {
    id: 'full-text-search', name: 'Inverted Indexes & Search', pillarId: 'data-storage',
    topicId: 'full-text-search',
    keywords: ['inverted index', 'full-text search', 'elasticsearch', 'tokenization', 'tf-idf', 'relevance scoring'],
    components: ['search-index'],
    summary: 'Term → documents mapping that powers search engines.',
  },
  {
    id: 'vector-search', name: 'Vector & Semantic Search', pillarId: 'data-storage',
    topicId: 'vector-indexes',
    keywords: ['vector database', 'embedding', 'ann', 'hnsw', 'semantic search', 'similarity search'],
    components: ['vector-db'],
    summary: 'Embeddings + approximate nearest neighbor indexes (HNSW) for meaning-based retrieval.',
  },
  {
    id: 'lsm-trees', name: 'LSM Trees & Write-Optimized Storage', pillarId: 'data-storage',
    topicId: 'state-engines',
    keywords: ['lsm tree', 'lsm-tree', 'sstable', 'memtable', 'compaction', 'write amplification', 'rocksdb'],
    components: [],
    summary: 'Memtables + SSTables + compaction: how write-heavy stores beat B-trees.',
  },
  {
    id: 'olap-warehousing', name: 'OLAP & Columnar Warehouses', pillarId: 'data-storage',
    topicId: 'analytical-olap',
    keywords: ['olap', 'columnar storage', 'data warehouse', 'star schema', 'column-oriented'],
    components: [],
    summary: 'Column-oriented storage for scanning billions of rows analytically.',
  },

  // ── Distributed data mechanics ────────────────────────────────
  {
    id: 'replication', name: 'Replication (Leader / Follower)', pillarId: 'distributed-mechanics',
    topicId: 'replication-strategies',
    keywords: ['leader follower', 'primary replica', 'single leader replication', 'multi-leader', 'failover replica', 'read replica', 'replication'],
    components: [],
    summary: 'Copies of data for availability and read scale — leader-based, multi-leader, leaderless.',
  },
  {
    id: 'replication-lag', name: 'Replication Lag & Read-Your-Writes', pillarId: 'distributed-mechanics',
    topicId: 'replication-strategies',
    keywords: ['replication lag', 'read-your-writes', 'read your own writes', 'monotonic reads', 'eventual consistency'],
    components: [],
    summary: 'Followers fall behind. What stale reads break, and the guarantees that fix them.',
  },
  {
    id: 'partitioning', name: 'Partitioning & Sharding', pillarId: 'distributed-mechanics',
    topicId: 'partitioning-sharding',
    keywords: ['sharding', 'partition key', 'range partitioning', 'hash partitioning', 'hot partition', 'shard rebalancing', 'skew'],
    components: [],
    summary: 'Splitting data across nodes: range vs hash, hot spots, rebalancing.',
  },
  {
    id: 'consistent-hashing', name: 'Consistent Hashing', pillarId: 'distributed-mechanics',
    topicId: 'partitioning-sharding',
    keywords: ['consistent hashing', 'hash ring', 'ring position', 'minimal reshuffling'],
    components: [],
    summary: 'The hash ring: adding a node only remaps the arc it owns, not every key.',
  },
  {
    id: 'virtual-nodes', name: 'Virtual Nodes & Rebalancing', pillarId: 'distributed-mechanics',
    topicId: 'partitioning-sharding',
    keywords: ['virtual node', 'vnode', 'virtual nodes', 'ring rebalancing'],
    components: [],
    summary: 'Many small ring positions per physical node — smooth load, faster rebalancing.',
  },
  {
    id: 'cap-theorem', name: 'CAP & PACELC', pillarId: 'distributed-mechanics',
    topicId: 'consistency-models',
    keywords: ['cap theorem', 'pacelc', 'partition tolerance', 'cp vs ap'],
    components: [],
    summary: 'Under a network partition you pick consistency or availability. PACELC adds the latency trade.',
  },
  {
    id: 'consistency-models', name: 'Consistency Models', pillarId: 'distributed-mechanics',
    topicId: 'consistency-models',
    keywords: ['linearizability', 'sequential consistency', 'causal consistency', 'strong consistency', 'consistency model'],
    components: [],
    summary: 'The spectrum from linearizable to eventual — and what each one costs.',
  },
  {
    id: 'quorums', name: 'Quorum Reads & Writes', pillarId: 'distributed-mechanics',
    topicId: 'replication-strategies',
    keywords: ['quorum', 'w + r > n', 'sloppy quorum', 'hinted handoff', 'read repair'],
    components: [],
    summary: 'W + R > N: overlapping read/write sets so someone always has the latest value.',
  },
  {
    id: 'failure-detection', name: 'Failure Detection & Gossip', pillarId: 'distributed-mechanics',
    topicId: 'consensus-coordination',
    keywords: ['heartbeat', 'gossip protocol', 'failure detection', 'phi accrual', 'membership'],
    components: [],
    summary: 'Heartbeats and gossip: how a cluster learns a node is gone.',
  },
  {
    id: 'leader-election', name: 'Leader Election & Failover', pillarId: 'distributed-mechanics',
    topicId: 'consensus-coordination',
    keywords: ['leader election', 'failover', 'split brain', 'fencing token'],
    components: [],
    summary: 'Choosing exactly one leader — and surviving split brain when the network lies.',
  },
  {
    id: 'consensus', name: 'Consensus (Raft / Paxos)', pillarId: 'distributed-mechanics',
    topicId: 'consensus-coordination',
    keywords: ['raft', 'paxos', 'consensus algorithm', 'log replication', 'term election'],
    components: [],
    summary: 'Getting machines to agree on a value despite failures — the hardest primitive.',
  },
  {
    id: 'coordination-services', name: 'Coordination Services', pillarId: 'distributed-mechanics',
    topicId: 'consensus-coordination',
    keywords: ['zookeeper', 'etcd', 'distributed lock', 'coordination service', 'lease'],
    components: [],
    summary: 'ZooKeeper/etcd: consensus packaged as locks, leases, and configuration.',
  },
  {
    id: 'distributed-kv', name: 'Distributed KV Stores (Dynamo)', pillarId: 'data-storage',
    topicId: 'kv-stores',
    keywords: ['dynamo', 'distributed key-value', 'vector clock', 'merkle tree', 'anti-entropy', 'riak'],
    components: ['nosql-db', 'cache'],
    summary: 'Dynamo-style stores: consistent hashing + quorums + gossip, assembled.',
  },
  {
    id: 'distributed-transactions', name: 'Distributed Transactions & Sagas', pillarId: 'distributed-mechanics',
    topicId: 'consistency-models',
    keywords: ['two-phase commit', '2pc', 'saga pattern', 'saga', 'outbox pattern', 'compensating transaction'],
    components: [],
    summary: '2PC, sagas, and the outbox pattern — atomicity across services.',
  },
  {
    id: 'stream-processing', name: 'Stream Processing & Windowing', pillarId: 'compute',
    topicId: 'stream-processors',
    keywords: ['stream processing', 'windowing', 'watermark', 'flink', 'exactly-once processing', 'stateful stream'],
    components: ['stream-processor'],
    summary: 'Continuous computation over event streams: windows, watermarks, state.',
  },
  {
    id: 'batch-processing', name: 'Batch Processing & MapReduce', pillarId: 'compute',
    topicId: 'batch-processing',
    keywords: ['mapreduce', 'batch job', 'spark', 'etl pipeline', 'dataflow'],
    components: ['batch-processor'],
    summary: 'Throughput-optimized offline computation over huge datasets.',
  },
  {
    id: 'hitl-gateways', name: 'Human-in-the-Loop Gateways', pillarId: 'observability',
    topicId: 'hitl-gateways',
    keywords: ['human in the loop', 'approval queue', 'review queue', 'escalation'],
    components: [],
    summary: 'Routing low-confidence automated decisions to humans without stalling the pipeline.',
  },
  {
    id: 'eval-frameworks', name: 'Evaluation Frameworks', pillarId: 'observability',
    topicId: 'eval-frameworks',
    keywords: ['eval framework', 'golden dataset', 'llm evaluation', 'regression eval', 'a/b test'],
    components: [],
    summary: 'Measuring quality of AI/ML behavior continuously, not anecdotally.',
  },

  // ── Architectural paradigms (capstones) ───────────────────────
  {
    id: 'heavy-write-pipeline', name: 'Heavy-Write Ingestion Pipeline', pillarId: 'paradigms',
    topicId: 'heavy-write',
    keywords: ['write-heavy', 'ingestion pipeline', 'firehose', 'buffered writes', 'write path'],
    components: ['event-bus', 'stream-processor', 'load-shedder'],
    summary: 'Absorb a firehose: buffer in a log, shed load early, write to LSM storage.',
  },
  {
    id: 'heavy-read-fanout', name: 'Heavy-Read Fan-Out', pillarId: 'paradigms',
    topicId: 'heavy-read',
    keywords: ['read-heavy', 'fan-out', 'fanout on write', 'fanout on read', 'timeline cache', 'celebrity problem'],
    components: ['cache', 'cdn'],
    summary: 'Serve millions of reads per write: cache tiers, CDNs, precomputed timelines.',
  },
  {
    id: 'spatial-grid', name: 'Real-Time Spatial Grid', pillarId: 'paradigms',
    topicId: 'spatial-grid',
    keywords: ['geohash', 'quadtree', 'geospatial index', 'proximity search', 'spatial grid'],
    components: [],
    summary: 'Geohash/quadtree partitioning plus live location streams (Uber-style).',
  },
  {
    id: 'multi-agent-blackboard', name: 'Multi-Agent Blackboard', pillarId: 'paradigms',
    topicId: 'multi-agent',
    keywords: ['multi-agent', 'blackboard pattern', 'agent orchestration', 'shared workspace'],
    components: ['event-bus'],
    summary: 'Agents coordinating through a shared event workspace with tool contracts.',
  },
]

/**
 * Directed prerequisite edges: learn `from` before `to`.
 * Kept as an explicit list (not nested in nodes) so tests can validate
 * the whole graph in one pass.
 */
export const GRAPH_EDGES = [
  // Fundamentals → building blocks
  { from: 'client-server', to: 'http-rest' },
  { from: 'client-server', to: 'dns' },
  { from: 'client-server', to: 'scalability-basics' },
  { from: 'latency-throughput', to: 'capacity-estimation' },
  { from: 'latency-throughput', to: 'caching-fundamentals' },
  { from: 'scalability-basics', to: 'load-balancing' },
  { from: 'dns', to: 'load-balancing' },
  { from: 'http-rest', to: 'reverse-proxy' },
  { from: 'load-balancing', to: 'reverse-proxy' },
  { from: 'scalability-basics', to: 'stateless-services' },
  { from: 'http-rest', to: 'stateless-services' },
  { from: 'stateless-services', to: 'serverless' },
  { from: 'sql-basics', to: 'db-indexing' },
  { from: 'sql-basics', to: 'transactions-acid' },
  { from: 'sql-basics', to: 'nosql-types' },
  { from: 'scalability-basics', to: 'nosql-types' },
  { from: 'scalability-basics', to: 'object-storage' },
  { from: 'caching-fundamentals', to: 'cache-strategies' },
  { from: 'cache-strategies', to: 'cache-invalidation' },
  { from: 'caching-fundamentals', to: 'cdn' },
  { from: 'dns', to: 'cdn' },
  { from: 'stateless-services', to: 'message-queues' },
  { from: 'message-queues', to: 'pubsub-logs' },
  { from: 'http-rest', to: 'websockets-streaming' },
  { from: 'http-rest', to: 'grpc-serialization' },
  { from: 'http-rest', to: 'agentic-tools' },
  { from: 'reverse-proxy', to: 'rate-limiting' },
  { from: 'availability-slos', to: 'timeouts-retries' },
  { from: 'http-rest', to: 'timeouts-retries' },
  { from: 'timeouts-retries', to: 'circuit-breakers' },
  { from: 'rate-limiting', to: 'load-shedding' },
  { from: 'message-queues', to: 'load-shedding' },
  { from: 'timeouts-retries', to: 'idempotency' },
  { from: 'message-queues', to: 'idempotency' },
  { from: 'availability-slos', to: 'metrics-logs' },
  { from: 'metrics-logs', to: 'distributed-tracing' },
  { from: 'stateless-services', to: 'distributed-tracing' },
  { from: 'db-indexing', to: 'full-text-search' },
  { from: 'db-indexing', to: 'vector-search' },
  { from: 'db-indexing', to: 'lsm-trees' },
  { from: 'sql-basics', to: 'olap-warehousing' },

  // Distributed mechanics
  { from: 'availability-slos', to: 'replication' },
  { from: 'transactions-acid', to: 'replication' },
  { from: 'replication', to: 'replication-lag' },
  { from: 'hashing-fundamentals', to: 'partitioning' },
  { from: 'scalability-basics', to: 'partitioning' },
  { from: 'partitioning', to: 'consistent-hashing' },
  { from: 'consistent-hashing', to: 'virtual-nodes' },
  { from: 'replication', to: 'cap-theorem' },
  { from: 'partitioning', to: 'cap-theorem' },
  { from: 'cap-theorem', to: 'consistency-models' },
  { from: 'replication-lag', to: 'consistency-models' },
  { from: 'replication', to: 'quorums' },
  { from: 'cap-theorem', to: 'quorums' },
  { from: 'availability-slos', to: 'failure-detection' },
  { from: 'timeouts-retries', to: 'failure-detection' },
  { from: 'replication', to: 'leader-election' },
  { from: 'failure-detection', to: 'leader-election' },
  { from: 'leader-election', to: 'consensus' },
  { from: 'quorums', to: 'consensus' },
  { from: 'consensus', to: 'coordination-services' },
  { from: 'consistent-hashing', to: 'distributed-kv' },
  { from: 'quorums', to: 'distributed-kv' },
  { from: 'nosql-types', to: 'distributed-kv' },
  { from: 'failure-detection', to: 'distributed-kv' },
  { from: 'distributed-kv', to: 'virtual-nodes' },
  { from: 'transactions-acid', to: 'distributed-transactions' },
  { from: 'message-queues', to: 'distributed-transactions' },
  { from: 'consensus', to: 'distributed-transactions' },
  { from: 'pubsub-logs', to: 'stream-processing' },
  { from: 'object-storage', to: 'batch-processing' },
  { from: 'partitioning', to: 'batch-processing' },
  { from: 'batch-processing', to: 'olap-warehousing' },
  { from: 'message-queues', to: 'hitl-gateways' },
  { from: 'metrics-logs', to: 'hitl-gateways' },
  { from: 'metrics-logs', to: 'eval-frameworks' },

  // Paradigms (capstones)
  { from: 'capacity-estimation', to: 'heavy-write-pipeline' },
  { from: 'pubsub-logs', to: 'heavy-write-pipeline' },
  { from: 'lsm-trees', to: 'heavy-write-pipeline' },
  { from: 'load-shedding', to: 'heavy-write-pipeline' },
  { from: 'capacity-estimation', to: 'heavy-read-fanout' },
  { from: 'cache-invalidation', to: 'heavy-read-fanout' },
  { from: 'cdn', to: 'heavy-read-fanout' },
  { from: 'replication-lag', to: 'heavy-read-fanout' },
  { from: 'partitioning', to: 'spatial-grid' },
  { from: 'websockets-streaming', to: 'spatial-grid' },
  { from: 'agentic-tools', to: 'multi-agent-blackboard' },
  { from: 'pubsub-logs', to: 'multi-agent-blackboard' },
]

/**
 * Curated learning tracks. `targets` are the capstone nodes; the full
 * track is the target set plus every transitive prerequisite, in
 * topological order (expandTrack).
 */
export const LEARNING_TRACKS = [
  {
    id: 'senior-distributed',
    name: 'Senior Distributed Systems',
    emoji: '🧠',
    description: 'Consensus, quorums, and Dynamo-style stores — the deep end interviewers use to separate senior candidates.',
    targets: ['consensus', 'coordination-services', 'distributed-kv', 'virtual-nodes', 'distributed-transactions'],
  },
  {
    id: 'storage-consistency',
    name: 'Storage & Consistency',
    emoji: '🗄️',
    description: 'From B-trees and LSM trees to replication lag and consistency models.',
    targets: ['lsm-trees', 'consistency-models', 'quorums', 'olap-warehousing'],
  },
  {
    id: 'caching-performance',
    name: 'Caching & Read Performance',
    emoji: '⚡',
    description: 'The full read path: cache tiers, invalidation, CDNs, and fan-out architectures.',
    targets: ['heavy-read-fanout'],
  },
  {
    id: 'resilience-traffic',
    name: 'Resilience & Traffic Control',
    emoji: '🛡️',
    description: 'Keeping systems alive under failure and overload: retries, breakers, shedding, idempotency.',
    targets: ['circuit-breakers', 'load-shedding', 'idempotency'],
  },
  {
    id: 'realtime-streaming',
    name: 'Real-Time & Streaming',
    emoji: '🌊',
    description: 'Event logs, stream processing, realtime push, and spatial systems.',
    targets: ['stream-processing', 'spatial-grid', 'heavy-write-pipeline'],
  },
  {
    id: 'ai-systems',
    name: 'AI & Agentic Systems',
    emoji: '🤖',
    description: 'Vector search, evals, HITL gateways, and multi-agent architectures.',
    targets: ['multi-agent-blackboard', 'vector-search', 'eval-frameworks', 'hitl-gateways'],
  },
]

/* ════════════════════════════════════════════════════════════════
   Pure graph algorithms
   ════════════════════════════════════════════════════════════════ */

/** Map: nodeId → node. */
export function nodeMap(nodes = GRAPH_NODES) {
  const map = new Map()
  for (const n of nodes) map.set(n.id, n)
  return map
}

/** Map: nodeId → array of prerequisite ids (direct only). */
export function prerequisitesOf(edges = GRAPH_EDGES) {
  const map = new Map()
  for (const e of edges) {
    if (!map.has(e.to)) map.set(e.to, [])
    map.get(e.to).push(e.from)
  }
  return map
}

/** Map: nodeId → array of dependent ids (direct only). */
export function dependentsOf(edges = GRAPH_EDGES) {
  const map = new Map()
  for (const e of edges) {
    if (!map.has(e.from)) map.set(e.from, [])
    map.get(e.from).push(e.to)
  }
  return map
}

/**
 * Validate the graph. Throws with a clear message when:
 *  - an edge references a missing node
 *  - the graph contains a cycle (prerequisites must form a DAG)
 *  - a node id is duplicated
 */
export function validateGraph(nodes = GRAPH_NODES, edges = GRAPH_EDGES) {
  const ids = new Set()
  for (const n of nodes) {
    if (ids.has(n.id)) throw new Error(`Duplicate node id: ${n.id}`)
    ids.add(n.id)
  }
  for (const e of edges) {
    if (!ids.has(e.from)) throw new Error(`Edge references missing node: ${e.from}`)
    if (!ids.has(e.to)) throw new Error(`Edge references missing node: ${e.to}`)
    if (e.from === e.to) throw new Error(`Self-loop on node: ${e.from}`)
  }
  const order = topologicalSort(nodes, edges)
  if (order.length !== nodes.length) {
    const sorted = new Set(order)
    const cyclic = nodes.filter((n) => !sorted.has(n.id)).map((n) => n.id)
    throw new Error(`Cycle detected in prerequisite graph involving: ${cyclic.join(', ')}`)
  }
  return true
}

/**
 * Kahn's algorithm. Returns node ids in prerequisite order.
 * When the graph has a cycle the result is shorter than `nodes` —
 * validateGraph() turns that into an explicit error.
 * Ties break on the original node-array order, so the sort is stable.
 */
export function topologicalSort(nodes = GRAPH_NODES, edges = GRAPH_EDGES) {
  const indegree = new Map(nodes.map((n) => [n.id, 0]))
  const adj = new Map(nodes.map((n) => [n.id, []]))
  for (const e of edges) {
    if (!indegree.has(e.from) || !indegree.has(e.to)) continue
    indegree.set(e.to, indegree.get(e.to) + 1)
    adj.get(e.from).push(e.to)
  }
  const orderIndex = new Map(nodes.map((n, i) => [n.id, i]))
  const queue = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id)
  const result = []
  while (queue.length > 0) {
    queue.sort((a, b) => orderIndex.get(a) - orderIndex.get(b))
    const id = queue.shift()
    result.push(id)
    for (const next of adj.get(id)) {
      indegree.set(next, indegree.get(next) - 1)
      if (indegree.get(next) === 0) queue.push(next)
    }
  }
  return result
}

/**
 * Depth of each node = longest prerequisite chain above it.
 * Foundations sit at depth 0. Used for the left-to-right layout.
 */
export function nodeDepths(nodes = GRAPH_NODES, edges = GRAPH_EDGES) {
  const prereqs = prerequisitesOf(edges)
  const depths = new Map()
  for (const id of topologicalSort(nodes, edges)) {
    const above = prereqs.get(id) || []
    depths.set(id, above.length === 0 ? 0 : Math.max(...above.map((p) => (depths.get(p) ?? 0))) + 1)
  }
  return depths
}

/** All transitive prerequisite ids of `nodeId` (excludes the node itself). */
export function ancestorsOf(nodeId, edges = GRAPH_EDGES) {
  const prereqs = prerequisitesOf(edges)
  const seen = new Set()
  const stack = [...(prereqs.get(nodeId) || [])]
  while (stack.length > 0) {
    const id = stack.pop()
    if (seen.has(id)) continue
    seen.add(id)
    for (const p of prereqs.get(id) || []) stack.push(p)
  }
  return seen
}

/** All transitive dependent ids of `nodeId` (excludes the node itself). */
export function descendantsOf(nodeId, edges = GRAPH_EDGES) {
  const deps = dependentsOf(edges)
  const seen = new Set()
  const stack = [...(deps.get(nodeId) || [])]
  while (stack.length > 0) {
    const id = stack.pop()
    if (seen.has(id)) continue
    seen.add(id)
    for (const d of deps.get(id) || []) stack.push(d)
  }
  return seen
}

/**
 * Expand a learning track into its full ordered node-id list:
 * targets plus all transitive prerequisites, in topological order.
 */
export function expandTrack(track, nodes = GRAPH_NODES, edges = GRAPH_EDGES) {
  const wanted = new Set(track.targets)
  for (const target of track.targets) {
    for (const anc of ancestorsOf(target, edges)) wanted.add(anc)
  }
  return topologicalSort(nodes, edges).filter((id) => wanted.has(id))
}

/**
 * Match one flashcard to graph nodes.
 * Keyword hits win; the source-topic link is the fallback when no
 * keyword matches (it is coarser — a topic can host several nodes).
 *
 * @param {{front: string, back: string, source_topic_id?: string}} card
 * @param {Array} [nodes]
 * @returns {string[]} Array of matching node ids (possibly empty)
 */
export function nodesForCard(card, nodes = GRAPH_NODES) {
  const text = `${card.front || ''} ${card.back || ''}`.toLowerCase()
  const keywordHits = []
  for (const node of nodes) {
    if (node.keywords.some((kw) => text.includes(kw))) keywordHits.push(node.id)
  }
  if (keywordHits.length > 0) return keywordHits
  if (card.source_topic_id) {
    return nodes.filter((n) => n.topicId === card.source_topic_id).map((n) => n.id)
  }
  return []
}
