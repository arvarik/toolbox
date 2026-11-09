/**
 * @fileoverview Architecture Linter Engine
 * Performs deterministic topology audits on canvas diagrams (nodes & edges)
 * to detect production risks, single points of failure (SPOFs), and antipatterns.
 */

export type AuditSeverity = 'critical' | 'warning' | 'info'

interface AuditNodeData {
  name?: string
  icon?: string
  category?: string
  [key: string]: unknown
}

export interface AuditNode {
  id: string
  data?: AuditNodeData
  [key: string]: unknown
}

export interface AuditEdge {
  id?: string
  source?: string
  target?: string
  from?: string
  to?: string
  label?: unknown
  protocol?: string
  data?: { protocol?: string; [key: string]: unknown }
  [key: string]: unknown
}

interface AuditFinding {
  id: string
  severity: AuditSeverity
  title: string
  message: string
  recommendation: string
  nodeIds: string[]
}

interface AuditStats {
  totalNodes: number
  totalEdges: number
  criticalCount: number
  warningCount: number
  infoCount: number
}

export interface AuditReport {
  score: number
  rating: string
  color: string
  findings: AuditFinding[]
  passes: string[]
  stats: AuditStats
}

interface AuditOptions {
  mode?: 'architecture' | 'concept'
}

function auditConceptMap(
  nodes: readonly AuditNode[],
  edges: readonly AuditEdge[],
  incoming: Map<string, string[]>,
  outgoing: Map<string, string[]>,
): AuditReport {
  const findings: AuditFinding[] = []
  const passes: string[] = []

  if (nodes.length === 1) {
    findings.push({
      id: 'single-concept',
      severity: 'info',
      title: 'Single Isolated Concept',
      message: `Only "${nodes[0].data?.name || nodes[0].id}" is on the map. A concept map builds meaning through linked propositions (Concept A → verb → Concept B).`,
      recommendation:
        'Add related mechanisms, theorems, or concrete examples and connect them with explicit linking phrases.',
      nodeIds: [nodes[0].id],
    })
  }

  if (nodes.length > 1) {
    const orphanNodes = nodes.filter(
      (n) =>
        (incoming.get(n.id)?.length ?? 0) === 0 &&
        (outgoing.get(n.id)?.length ?? 0) === 0,
    )
    if (orphanNodes.length > 0) {
      findings.push({
        id: 'orphan-concepts',
        severity: 'warning',
        title: 'Disconnected / Orphan Concepts',
        message: `${orphanNodes.length} concept(s) have no incoming or outgoing propositions: ${orphanNodes.map((n) => n.data?.name || n.id).join(', ')}.`,
        recommendation:
          'Link every concept into at least one proposition using a clear relational verb (e.g., "implies", "depends on", "example of").',
        nodeIds: orphanNodes.map((n) => n.id),
      })
    } else {
      passes.push(
        'Connected Knowledge Network: Every concept participates in at least one proposition.',
      )
    }
  }

  if (edges.length > 0) {
    const unlabeledEdges = edges.filter(
      (e) => !String(e.label ?? e.protocol ?? e.data?.protocol ?? '').trim(),
    )
    if (unlabeledEdges.length > 0) {
      const nodeIds = Array.from(
        new Set(
          unlabeledEdges.flatMap((e) =>
            [e.source || e.from, e.target || e.to].filter(
              (v): v is string => Boolean(v),
            ),
          ),
        ),
      )
      findings.push({
        id: 'unlabeled-propositions',
        severity: 'warning',
        title: 'Unlabeled Edges (Missing Linking Phrases)',
        message: `${unlabeledEdges.length} of ${edges.length} connection(s) lack a semantic linking phrase, leaving the relationship ambiguous.`,
        recommendation:
          'Select a linking phrase (such as "implies", "depends on", "causes", "contrasts with", or "example of") before or when connecting concepts.',
        nodeIds,
      })
    } else {
      passes.push('Explicit Propositions: All connections carry semantic linking phrases.')
    }
  }

  const overloadedHubs = nodes.filter(
    (n) =>
      (incoming.get(n.id)?.length || 0) + (outgoing.get(n.id)?.length || 0) > 7,
  )
  if (overloadedHubs.length > 0) {
    findings.push({
      id: 'star-hub-overload',
      severity: 'warning',
      title: 'Single-Hub Star Topology Overload',
      message: `${overloadedHubs.map((n) => n.data?.name || n.id).join(', ')} connects directly to more than 7 nodes, flattening conceptual hierarchy into a spoke list.`,
      recommendation:
        'Introduce intermediate grouping concepts or cross-links between sub-concepts to express deeper structure.',
      nodeIds: overloadedHubs.map((n) => n.id),
    })
  } else if (nodes.length >= 3 && edges.length >= 2) {
    passes.push(
      'Balanced Hierarchy: Concept degree distribution avoids flat star-hub overload.',
    )
  }

  const hasGroundingAnchor = nodes.some((n) => {
    const cat = String(n.data?.category || '').toLowerCase()
    const name = String(n.data?.name || '').toLowerCase()
    return (
      cat === 'evidence' ||
      cat === 'inquiry' ||
      name.includes('example') ||
      name.includes('counterexample') ||
      name.includes('hypothesis')
    )
  })
  if (nodes.length >= 4 && !hasGroundingAnchor) {
    findings.push({
      id: 'missing-concrete-anchoring',
      severity: 'info',
      title: 'No Concrete Example or Counterexample Anchor',
      message:
        'Abstract concepts are mapped without a concrete example, counterexample, or boundary question.',
      recommendation:
        'Drop a Concrete Example or Counterexample / Edge Case node to test the boundaries of your mental model.',
      nodeIds: [],
    })
  } else if (hasGroundingAnchor) {
    passes.push(
      'Concrete Grounding: Includes concrete examples, counterexamples, or inquiry nodes.',
    )
  }

  let score = 100
  for (const f of findings) {
    if (f.severity === 'critical') score -= 25
    else if (f.severity === 'warning') score -= 10
    else if (f.severity === 'info') score -= 5
  }
  score = Math.max(0, Math.min(100, score))

  let rating = 'Well-Structured Concept Map'
  let color = 'var(--color-success, #22c55e)'
  if (score < 50) {
    rating = 'Unstructured Concept Sketch'
    color = 'var(--color-error, #ef4444)'
  } else if (score < 75) {
    rating = 'Fragmented Concept Map'
    color = 'var(--color-warning, #f59e0b)'
  } else if (score < 90) {
    rating = 'Coherent Map with Refinement Gaps'
    color = 'var(--color-info, #60a5fa)'
  }

  return {
    score,
    rating,
    color,
    findings,
    passes,
    stats: {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      criticalCount: findings.filter((f) => f.severity === 'critical').length,
      warningCount: findings.filter((f) => f.severity === 'warning').length,
      infoCount: findings.filter((f) => f.severity === 'info').length,
    },
  }
}

/**
 * Audit an architecture or concept graph for structural health, risks, and antipatterns.
 */
export function auditArchitecture(
  nodes: readonly AuditNode[] = [],
  edges: readonly AuditEdge[] = [],
  options: AuditOptions = {},
): AuditReport {
  if (!nodes || nodes.length === 0) {
    return {
      score: 100,
      rating: 'Empty Canvas',
      color: 'var(--color-text-secondary)',
      findings: [],
      passes: [],
      stats: {
        totalNodes: 0,
        totalEdges: 0,
        criticalCount: 0,
        warningCount: 0,
        infoCount: 0,
      },
    }
  }

  const findings: AuditFinding[] = []
  const passes: string[] = []

  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const incoming = new Map<string, string[]>()
  const outgoing = new Map<string, string[]>()

  for (const n of nodes) {
    incoming.set(n.id, [])
    outgoing.set(n.id, [])
  }

  for (const e of edges) {
    const src = e.source ?? e.from
    const tgt = e.target ?? e.to
    if (src && tgt) {
      outgoing.get(src)?.push(tgt)
      incoming.get(tgt)?.push(src)
    }
  }

  if (options?.mode === 'concept') {
    return auditConceptMap(nodes, edges, incoming, outgoing)
  }

  // Component categories and types
  const clients = nodes.filter((n) => n.data?.category === 'Clients')
  const compute = nodes.filter((n) => n.data?.category === 'Compute')
  const storage = nodes.filter((n) => n.data?.category === 'Storage')
  const resiliency = nodes.filter((n) => n.data?.category === 'Resiliency')

  const hasLoadBalancer = compute.some(
    (n) =>
      n.data?.name?.toLowerCase().includes('load balancer') ||
      n.data?.icon === 'split',
  )
  const hasApiGateway = compute.some(
    (n) =>
      n.data?.name?.toLowerCase().includes('gateway') ||
      n.data?.icon === 'door-open',
  )
  const hasCache = storage.some(
    (n) =>
      n.data?.name?.toLowerCase().includes('cache') || n.data?.icon === 'zap',
  )
  const hasQueue = compute.some(
    (n) =>
      n.data?.name?.toLowerCase().includes('queue') ||
      n.data?.name?.toLowerCase().includes('bus') ||
      n.data?.name?.toLowerCase().includes('stream') ||
      n.data?.icon === 'mail' ||
      n.data?.icon === 'radio',
  )
  const hasRateLimiter = resiliency.some(
    (n) =>
      n.data?.name?.toLowerCase().includes('rate limiter') ||
      n.data?.icon === 'shield',
  )
  const hasCircuitBreaker = resiliency.some(
    (n) =>
      n.data?.name?.toLowerCase().includes('circuit breaker') ||
      n.data?.icon === 'alert-triangle',
  )

  // 1. Orphan / Disconnected Nodes Check
  if (nodes.length > 1) {
    const orphanNodes = nodes.filter(
      (n) =>
        (incoming.get(n.id)?.length ?? 0) === 0 &&
        (outgoing.get(n.id)?.length ?? 0) === 0,
    )
    if (orphanNodes.length > 0) {
      findings.push({
        id: 'orphan-components',
        severity: 'warning',
        title: 'Disconnected Components',
        message: `${orphanNodes.length} component(s) are completely disconnected from the system flow: ${orphanNodes.map((n) => n.data?.name || n.id).join(', ')}.`,
        recommendation:
          'Connect these components with edges or remove unused nodes to clarify the data flow.',
        nodeIds: orphanNodes.map((n) => n.id),
      })
    }
  }

  // 2. Direct Ingress Check (Client -> Backend without Gateway / Load Balancer)
  if (clients.length > 0) {
    const unshieldedTargets: Array<{ client: AuditNode; target: AuditNode }> = []
    for (const c of clients) {
      const targets = outgoing.get(c.id) || []
      for (const tId of targets) {
        const target = nodeMap.get(tId)
        if (!target) continue
        const isIngressShield =
          target.data?.icon === 'door-open' || // API Gateway
          target.data?.icon === 'split' || // Load Balancer
          target.data?.icon === 'globe' || // CDN
          target.data?.icon === 'shield' || // Rate Limiter / WAF
          target.data?.category === 'Resiliency'
        if (!isIngressShield) {
          unshieldedTargets.push({ client: c, target })
        }
      }
    }

    if (unshieldedTargets.length > 0) {
      findings.push({
        id: 'unshielded-ingress',
        severity: 'critical',
        title: 'Direct Client Ingress (Missing Gateway/LB)',
        message:
          'Client traffic directly enters backend services without an API Gateway or Load Balancer at the perimeter.',
        recommendation:
          'Route client traffic through an API Gateway or Layer 7 Load Balancer for SSL termination, request routing, and perimeter auth.',
        nodeIds: unshieldedTargets.map((u) => u.target.id),
      })
    } else {
      passes.push(
        'Perimeter Shield: Client traffic terminates at an API Gateway or Load Balancer.',
      )
    }
  }

  if (hasApiGateway) {
    passes.push(
      'API Gateway: Unified ingress for routing, TLS termination, and request governance.',
    )
  }

  // 3. Single Point of Failure (SPOF) in Compute Tier
  const appServers = compute.filter(
    (n) => !['load-balancer', 'api-gateway', 'cdn'].includes(n.data?.icon ?? ''),
  )
  if (appServers.length === 1 && !hasLoadBalancer) {
    findings.push({
      id: 'compute-spof',
      severity: 'critical',
      title: 'Single Point of Failure (Compute)',
      message: `Only a single compute instance ("${appServers[0].data?.name}") was detected with no upstream load balancer. If this instance crashes, the entire application becomes unavailable.`,
      recommendation:
        'Add horizontal replicas behind a Load Balancer to guarantee high availability across availability zones.',
      nodeIds: [appServers[0].id],
    })
  } else if (hasLoadBalancer) {
    passes.push('High Availability: Traffic is distributed via Load Balancer.')
  }

  // 4. Missing In-Memory Caching Layer
  const persistentDbs = storage.filter(
    (n) =>
      n.data?.icon === 'database' ||
      n.data?.icon === 'hard-drive' ||
      (n.data?.category === 'Storage' &&
        !n.data?.name?.toLowerCase().includes('cache')),
  )

  if (persistentDbs.length > 0) {
    if (!hasCache) {
      findings.push({
        id: 'missing-cache-tier',
        severity: 'warning',
        title: 'Missing Caching Layer (Cache-Aside Gap)',
        message:
          'Direct reads hit persistent databases without an in-memory caching tier (Redis/Memcached). High read volume will exhaust connection pools and degrade query latency.',
        recommendation:
          'Place a Cache (Redis) in front of the database using Cache-Aside (lazy loading) to serve hot keys.',
        nodeIds: persistentDbs.map((d) => d.id),
      })
    } else {
      passes.push(
        'Read Optimization: In-memory cache layer relieves database read contention.',
      )
    }
  }

  // 5. Unbuffered / Synchronous Write Pipeline
  const directDbWrites: Array<{ source: AuditNode; target: AuditNode }> = []
  for (const c of appServers) {
    const targets = outgoing.get(c.id) || []
    for (const tId of targets) {
      const target = nodeMap.get(tId)
      if (
        target &&
        (target.data?.icon === 'database' || target.data?.icon === 'hard-drive')
      ) {
        directDbWrites.push({ source: c, target })
      }
    }
  }

  if (directDbWrites.length > 0 && !hasQueue) {
    findings.push({
      id: 'unbuffered-writes',
      severity: 'warning',
      title: 'Synchronous / Unbuffered Writes',
      message:
        'Compute services execute synchronous writes directly into persistent databases. Sudden spikes in user writes can exhaust connection pools and trigger cascading timeouts.',
      recommendation:
        'Introduce an asynchronous Message Queue (RabbitMQ) or Event Bus (Kafka) to buffer bursts and smooth ingestion rates.',
      nodeIds: directDbWrites.map((d) => d.source.id),
    })
  } else if (hasQueue) {
    passes.push(
      'Decoupled Asynchrony: Message queues/event streaming buffer write surges.',
    )
  }

  // 6. Missing Rate Limiter / Traffic Shaping
  if (clients.length > 0 && !hasRateLimiter) {
    findings.push({
      id: 'missing-rate-limiter',
      severity: 'info',
      title: 'Missing Ingress Rate Limiter',
      message:
        'No rate limiting or load shedding components found. Malicious traffic, scrapers, or runaway retry storms could overwhelm upstream services.',
      recommendation:
        'Deploy a Token Bucket or Leaky Bucket Rate Limiter at the API Gateway or reverse proxy.',
      nodeIds: [],
    })
  } else if (hasRateLimiter) {
    passes.push(
      'Traffic Protection: Rate limiter guards against abuse and burst exhaustion.',
    )
  }

  // 7. Resiliency Check (Circuit Breakers)
  if (appServers.length > 1 && !hasCircuitBreaker) {
    findings.push({
      id: 'missing-circuit-breaker',
      severity: 'info',
      title: 'No Circuit Breaker Protection',
      message:
        'Inter-service communication lacks circuit breakers or timeout retry budgets. If a downstream microservice degrades, callers will experience cascading thread pool starvation.',
      recommendation:
        'Wrap inter-service remote calls in Circuit Breakers to fail fast during downstream outages.',
      nodeIds: [],
    })
  } else if (hasCircuitBreaker) {
    passes.push('Fault Isolation: Circuit breaker prevents cascading failures.')
  }

  // Calculate Health Score
  let score = 100
  for (const f of findings) {
    if (f.severity === 'critical') score -= 25
    else if (f.severity === 'warning') score -= 10
    else if (f.severity === 'info') score -= 5
  }
  score = Math.max(0, Math.min(100, score))

  let rating = 'Production Ready'
  let color = 'var(--color-success, #22c55e)'
  if (score < 50) {
    rating = 'Fragile Architecture'
    color = 'var(--color-error, #ef4444)'
  } else if (score < 75) {
    rating = 'High Risk Gaps'
    color = 'var(--color-warning, #f59e0b)'
  } else if (score < 90) {
    rating = 'Solid with Hardening Gaps'
    color = 'var(--color-info, #60a5fa)'
  }

  return {
    score,
    rating,
    color,
    findings,
    passes,
    stats: {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      criticalCount: findings.filter((f) => f.severity === 'critical').length,
      warningCount: findings.filter((f) => f.severity === 'warning').length,
      infoCount: findings.filter((f) => f.severity === 'info').length,
    },
  }
}
