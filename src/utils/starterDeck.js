/**
 * Curated high-yield starter flashcards for Day-0 onboarding.
 * Each card includes keywords that match the Knowledge Graph concept nodes
 * so reviewing them automatically populates the SRS mastery heatmap!
 */
export const CURATED_STARTER_CARDS = [
  {
    front: 'Consistent Hashing — How does it minimize key remapping when nodes join or leave?',
    back: '**Consistent Hashing** maps both cache nodes and data keys to a virtual circular 360° ring ($0$ to $2^{32}-1$). A key is routed to the first node encountered clockwise.\n\n• When a node is added or removed, only $K/N$ keys need migration on average (where $K$ = total keys, $N$ = node count), compared to nearly 100% in naive modulo hashing.\n• **Virtual nodes** (vnodes) assign multiple ring tokens per physical machine to ensure uniform load distribution and eliminate hot spots.',
    source_pillar_id: 'distributed-mechanics',
    source_topic_id: 'partitioning-sharding',
  },
  {
    front: 'CAP Theorem — Why is it impossible to guarantee both Consistency and Availability during a partition?',
    back: 'In any distributed data store, network partitions ($P$) are inevitable physical realities (hardware failure, packet drops).\n\nDuring a partition, a system must choose between:\n• **Consistency (C)**: Return an error or timeout to guarantee all reads observe the latest write, sacrificing availability.\n• **Availability (A)**: Return available local data from reachable nodes immediately, accepting stale reads.\n\nIn practice, modern distributed systems configure tunable consistency ($R + W > N$) rather than rigid binary CP or AP.',
    source_pillar_id: 'distributed-mechanics',
    source_topic_id: 'consensus-coordination',
  },
  {
    front: 'Database Indexing (B-Tree vs LSM-Tree) — What are the core architectural tradeoffs?',
    back: '• **B-Tree**: Read-optimized. Self-balancing tree storing sorted pages on disk. In-place updates with random disk I/O. Best for read-heavy OLTP workloads (PostgreSQL, MySQL).\n\n• **LSM-Tree**: Write-optimized. Buffers writes in memory (*MemTable*), logs sequentially to disk (*WAL*), and flushes immutable *SSTables*. Reads check memory then SSTables using Bloom Filters, merging during background compaction. Best for high write throughput (Cassandra, RocksDB).',
    source_pillar_id: 'data-storage',
    source_topic_id: 'relational-oltp',
  },
  {
    front: 'Load Balancing (L4 vs L7) — What is the difference between Transport and Application layer balancing?',
    back: '• **Layer 4 (Transport)**: Operates at TCP/UDP level. Inspects IP address and port without decrypting or inspecting HTTP headers or body. Extremely fast with low CPU overhead (e.g., AWS NLB, IPVS).\n\n• **Layer 7 (Application)**: Operates at HTTP/HTTPS level. Terminates TLS, parses URL paths, headers, and cookies. Enables intelligent routing (e.g. `/api/v2` to microservice B), sticky sessions, and edge rate limiting (e.g., NGINX, Envoy, AWS ALB).',
    source_pillar_id: 'compute',
    topicId: 'traffic-gateways',
    source_topic_id: 'traffic-gateways',
  },
  {
    front: 'Cache-Aside (Lazy Loading) — What is the lifecycle and primary failure modes?',
    back: '• **Read Flow**: Application queries Cache first. On Cache Hit, return data. On Cache Miss, query Database, write data to Cache with a TTL, and return data.\n• **Write Flow**: Application writes directly to the Database, then **invalidates (deletes)** the cache key rather than updating it to avoid race conditions.\n\n• **Failure Modes**: Cache stampede (thundering herd on cold miss), stale reads if DB write succeeds but eviction fails.',
    source_pillar_id: 'data-storage',
    source_topic_id: 'caching-strategies',
  },
  {
    front: 'Rate Limiting (Token Bucket Algorithm) — How does it handle bursts while enforcing a steady rate?',
    back: 'A bucket holds tokens up to capacity $C$. Tokens are added continuously at a steady rate of $R$ tokens/second. Each request consumes 1 token. If the bucket is empty, requests are rejected with HTTP 429 Too Many Requests.\n\n• **Burst Support**: Can immediately serve up to $C$ requests in a sudden burst.\n• **Sustained Limit**: Average throughput is strictly bounded by $R$ tokens/sec.\n• **Memory Efficiency**: Only stores timestamp of last refill and current token count.',
    source_pillar_id: 'resiliency',
    source_topic_id: 'traffic-shaping',
  },
  {
    front: 'Database Sharding — What makes an effective shard key and what happens with a poor choice?',
    back: 'An effective shard key guarantees:\n1. **Uniform Data Distribution**: Prevents partition size imbalances.\n2. **Uniform Query Distribution**: Prevents traffic hot spots (e.g., celebrity user problem).\n3. **Query Co-location**: Allows high-frequency queries to route to a single shard, avoiding expensive cross-shard scatter-gather joins.\n\n• **Bad Key Example**: Monotonically increasing timestamps or auto-incrementing IDs direct all current writes to the newest single shard.',
    source_pillar_id: 'data-storage',
    source_topic_id: 'partitioning-sharding',
  },
  {
    front: 'Message Queues vs Event Streams (RabbitMQ vs Kafka) — When should each be chosen?',
    back: '• **Message Queue (e.g., RabbitMQ)**: Broker tracks message consumption per consumer. Messages are deleted once acknowledged. Ideal for discrete worker job distribution, complex routing (topic/fanout exchanges), and transient RPC tasks.\n\n• **Event Log (e.g., Kafka)**: Append-only distributed commit log. Consumers track their own offsets. Messages persist independently of consumers (retention period). Ideal for event sourcing, stream processing, high throughput, and multiple consumers replaying history.',
    source_pillar_id: 'async-processing',
    source_topic_id: 'message-brokers',
  },
  {
    front: 'Circuit Breaker Pattern — Explain the 3 states and how it stops cascading failures.',
    back: '• **Closed**: Normal operation. Requests pass downstream. Failure count is monitored.\n• **Open**: Error rate exceeds threshold. Circuit trips: requests immediately fail fast (or return fallback) without calling the downstream dependency, preventing thread exhaustion.\n• **Half-Open**: After a cooldown timeout, a small probe batch of requests is allowed through. If successful, resets to Closed; if failures persist, reverts to Open.',
    source_pillar_id: 'resiliency',
    source_topic_id: 'fault-tolerance',
  },
  {
    front: 'Content Delivery Network (CDN) — How does Anycast routing accelerate global delivery?',
    back: 'CDNs place edge servers globally close to end-users (Points of Presence - PoPs).\n\n• **Anycast Routing**: Directs client DNS and TCP handshakes to the topologically closest PoP sharing the same IP address.\n• **Static Content**: Images, video segments, and bundles cached at edge with HTTP Cache-Control headers.\n• **Dynamic Content**: TLS handshake terminates at the edge; persistent TCP/HTTP/2 connection pools back to origin reduce round-trip latency.',
    source_pillar_id: 'network-protocols',
    source_topic_id: 'content-delivery',
  },
  {
    front: 'Bloom Filters — How do they prevent unnecessary disk reads in distributed storage?',
    back: 'A space-efficient probabilistic data structure for set membership testing.\n\n• **Guarantees**: Can return "Definitely Not in Set" ($0\\%$ false negative) or "Possibly in Set" (tunable small false positive rate).\n• **Database Use**: In LSM-Trees (Cassandra, RocksDB), checks if an SSTable contains a row key before making expensive disk seeks. If Bloom Filter says "no", disk read is skipped entirely.',
    source_pillar_id: 'data-storage',
    source_topic_id: 'caching-strategies',
  },
  {
    front: 'Two-Phase Commit (2PC) — How does 2PC ensure atomicity and what is its main limitation?',
    back: '• **Phase 1 (Prepare)**: Coordinator asks cohorts if they can commit. Cohorts write to local WAL, acquire locks, and vote `YES` or `NO`.\n• **Phase 2 (Commit/Abort)**: If all vote `YES`, Coordinator logs commit and broadcasts `COMMIT`. If any vote `NO` or timeout, broadcasts `ROLLBACK`.\n\n• **Limitation**: 2PC is a **blocking protocol**. If Coordinator crashes after cohorts vote `YES`, cohorts hold locks indefinitely waiting for resolution, causing system stall.',
    source_pillar_id: 'distributed-mechanics',
    source_topic_id: 'consensus-coordination',
  },
  {
    front: 'Write-Ahead Logging (WAL) — Why is append-only logging essential for transaction durability?',
    back: 'Instead of writing modified pages immediately to random disk locations (slow random I/O), the database appends changes sequentially to an immutable append-only log on disk *before* acknowledging the client.\n\n• **Crash Recovery**: If the server crashes, memory state is lost, but the database replays the WAL on restart to reapply committed transactions (REDO) and revert uncommitted ones (UNDO).',
    source_pillar_id: 'data-storage',
    source_topic_id: 'relational-oltp',
  },
  {
    front: 'Gossip Protocol — How do distributed nodes detect cluster membership without a leader?',
    back: 'In decentralized clusters (Cassandra, Consul), each node periodically picks $k$ random peers and exchanges heartbeat counters and node states.\n\n• Information spreads exponentially across the cluster in $O(\\log N)$ rounds.\n• **Failure Detection**: If a peer node\'s heartbeat timestamp stops advancing for a configurable window (phi accrual failure detector), the cluster marks the node suspicious, then dead.',
    source_pillar_id: 'distributed-mechanics',
    source_topic_id: 'consensus-coordination',
  },
  {
    front: 'Quorum Consensus (R + W > N) — How does tunable consistency prevent stale reads?',
    back: 'In a cluster of $N$ replicas:\n• $W$ = minimum write acknowledgments required before success.\n• $R$ = minimum replica responses required for a read.\n\nBy the **Pigeonhole Principle**, if $W + R > N$, the write replica set and read replica set must overlap by at least one node. The client coordinator inspects timestamps or vector clocks from all $R$ responses and returns the newest version, ensuring strong consistency.',
    source_pillar_id: 'distributed-mechanics',
    source_topic_id: 'consensus-coordination',
  },
]

export const STARTER_DECK_META = {
  name: 'System Design Foundations',
  description: 'Curated starter deck covering essential system design interview patterns, distributed mechanics, and architecture primitives.',
  tags: 'fundamentals, architecture, distributed-systems',
  color_index: 0,
}

/**
 * Creates the curated starter deck with all 15 foundational cards.
 * @param {Object} decksApi - decksApi client
 * @param {Object} flashcardsApi - flashcardsApi client
 * @returns {Promise<Object>} Created deck object
 */
export async function seedCuratedStarterDeck(decksApi, flashcardsApi) {
  const deck = await decksApi.create(STARTER_DECK_META)
  
  for (const card of CURATED_STARTER_CARDS) {
    await flashcardsApi.create(deck.id, card)
  }
  
  return deck
}
