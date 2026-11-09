import { describe, expect, it } from 'vitest'
import { auditArchitecture } from '../utils/architectureLinter'
import type { AuditEdge, AuditNode, AuditSeverity } from '../utils/architectureLinter'

describe('Architecture Linter Engine', () => {
  it('handles empty canvas safely', () => {
    const report = auditArchitecture([], [])
    expect(report.score).toBe(100)
    expect(report.rating).toBe('Empty Canvas')
    expect(report.findings).toHaveLength(0)
    expect(report.stats.totalNodes).toBe(0)
  })

  const findingCases: Array<{
    name: string
    nodes: AuditNode[]
    edges: AuditEdge[]
    expectedId: string
    severity: AuditSeverity
  }> = [
    {
      name: 'detects orphan / disconnected components',
      nodes: [
        { id: 'app-1', data: { name: 'App Server', category: 'Compute', icon: 'box' } },
        { id: 'db-1', data: { name: 'Postgres', category: 'Storage', icon: 'database' } },
      ],
      edges: [],
      expectedId: 'orphan-components',
      severity: 'warning',
    },
    {
      name: 'flags unshielded direct client ingress as critical',
      nodes: [
        { id: 'client-1', data: { name: 'Web Client', category: 'Clients', icon: 'monitor' } },
        { id: 'app-1', data: { name: 'Microservice', category: 'Compute', icon: 'box' } },
      ],
      edges: [{ id: 'e1', source: 'client-1', target: 'app-1' }],
      expectedId: 'unshielded-ingress',
      severity: 'critical',
    },
    {
      name: 'detects compute SPOF when only 1 app instance exists without LB',
      nodes: [{ id: 'app-1', data: { name: 'Single Server', category: 'Compute', icon: 'box' } }],
      edges: [],
      expectedId: 'compute-spof',
      severity: 'critical',
    },
    {
      name: 'detects missing cache tier when persistent DB is queried directly',
      nodes: [
        { id: 'app-1', data: { name: 'Backend', category: 'Compute', icon: 'box' } },
        { id: 'db-1', data: { name: 'SQL Database', category: 'Storage', icon: 'database' } },
      ],
      edges: [{ id: 'e1', source: 'app-1', target: 'db-1' }],
      expectedId: 'missing-cache-tier',
      severity: 'warning',
    },
    {
      name: 'detects unbuffered writes to database without a queue',
      nodes: [
        { id: 'app-1', data: { name: 'Backend', category: 'Compute', icon: 'box' } },
        { id: 'db-1', data: { name: 'SQL Database', category: 'Storage', icon: 'database' } },
      ],
      edges: [{ id: 'e1', source: 'app-1', target: 'db-1' }],
      expectedId: 'unbuffered-writes',
      severity: 'warning',
    },
  ]

  for (const tc of findingCases) {
    it(tc.name, () => {
      const report = auditArchitecture(tc.nodes, tc.edges)
      const finding = report.findings.find((f) => f.id === tc.expectedId)
      expect(finding).toBeDefined()
      expect(finding?.severity).toBe(tc.severity)
    })
  }

  it('passes ingress check when API Gateway shields backend', () => {
    const report = auditArchitecture(
      [
        { id: 'client-1', data: { name: 'Web Client', category: 'Clients', icon: 'monitor' } },
        { id: 'gw-1', data: { name: 'API Gateway', category: 'Compute', icon: 'door-open' } },
        { id: 'app-1', data: { name: 'Microservice', category: 'Compute', icon: 'box' } },
      ],
      [
        { id: 'e1', source: 'client-1', target: 'gw-1' },
        { id: 'e2', source: 'gw-1', target: 'app-1' },
      ],
    )
    expect(report.findings.find((f) => f.id === 'unshielded-ingress')).toBeUndefined()
    expect(report.passes.some((p) => p.includes('Perimeter Shield'))).toBe(true)
  })

  it('passes write buffering when message queue decouples DB writes', () => {
    const report = auditArchitecture(
      [
        { id: 'app-1', data: { name: 'Backend', category: 'Compute', icon: 'box' } },
        { id: 'queue-1', data: { name: 'Message Queue', category: 'Compute', icon: 'mail' } },
        { id: 'db-1', data: { name: 'SQL Database', category: 'Storage', icon: 'database' } },
      ],
      [
        { id: 'e1', source: 'app-1', target: 'queue-1' },
        { id: 'e2', source: 'queue-1', target: 'db-1' },
      ],
    )
    expect(report.findings.find((f) => f.id === 'unbuffered-writes')).toBeUndefined()
    expect(report.passes.some((p) => p.includes('Decoupled Asynchrony'))).toBe(true)
  })

  it('scores a full resilient topology at 100 (Production Ready)', () => {
    const nodes: AuditNode[] = [
      { id: 'client-1', data: { name: 'Web Client', category: 'Clients', icon: 'monitor' } },
      { id: 'gw-1', data: { name: 'API Gateway', category: 'Compute', icon: 'door-open' } },
      { id: 'lb-1', data: { name: 'Load Balancer', category: 'Compute', icon: 'split' } },
      { id: 'app-1', data: { name: 'Service A', category: 'Compute', icon: 'box' } },
      { id: 'app-2', data: { name: 'Service B', category: 'Compute', icon: 'box' } },
      { id: 'cache-1', data: { name: 'Cache (Redis)', category: 'Storage', icon: 'zap' } },
      { id: 'queue-1', data: { name: 'Message Queue', category: 'Compute', icon: 'mail' } },
      { id: 'db-1', data: { name: 'SQL Database', category: 'Storage', icon: 'database' } },
      { id: 'rate-1', data: { name: 'Rate Limiter', category: 'Resiliency', icon: 'shield' } },
      { id: 'cb-1', data: { name: 'Circuit Breaker', category: 'Resiliency', icon: 'alert-triangle' } },
    ]
    const edges: AuditEdge[] = [
      { id: 'e0', source: 'client-1', target: 'rate-1' },
      { id: 'e1', source: 'rate-1', target: 'gw-1' },
      { id: 'e2', source: 'gw-1', target: 'lb-1' },
      { id: 'e3', source: 'lb-1', target: 'app-1' },
      { id: 'e4', source: 'lb-1', target: 'app-2' },
      { id: 'e5', source: 'app-1', target: 'cache-1' },
      { id: 'e6', source: 'app-1', target: 'cb-1' },
      { id: 'e7', source: 'cb-1', target: 'queue-1' },
      { id: 'e8', source: 'queue-1', target: 'db-1' },
    ]

    const report = auditArchitecture(nodes, edges)
    expect(report.score).toBe(100)
    expect(report.rating).toBe('Production Ready')
    expect(report.findings).toHaveLength(0)
    expect(report.passes.length).toBeGreaterThanOrEqual(4)
  })

  it('supports domain-general Novakian concept map audit mode', () => {
    const single = auditArchitecture(
      [{ id: 'c1', data: { name: 'Ownership' } }],
      [],
      { mode: 'concept' },
    )
    expect(single.findings.some((f) => f.id === 'single-concept')).toBe(true)

    const partial = auditArchitecture(
      [
        { id: 'k1', data: { name: 'Ownership', category: 'Foundations', icon: 'brain' } },
        { id: 'k2', data: { name: 'Move Semantics', category: 'Mechanisms', icon: 'cog' } },
        { id: 'k3', data: { name: 'Orphan Concept', category: 'Foundations', icon: 'brain' } },
      ],
      [{ id: 'ce1', source: 'k1', target: 'k2' }],
      { mode: 'concept' },
    )
    const ids = partial.findings.map((f) => f.id)
    expect(ids).not.toContain('compute-spof')
    expect(ids).not.toContain('missing-cache-tier')
    expect(ids).toContain('orphan-concepts')
    expect(ids).toContain('unlabeled-propositions')

    const clean = auditArchitecture(
      [
        { id: 'k1', data: { name: 'Ownership', category: 'Foundations', icon: 'brain' } },
        { id: 'k2', data: { name: 'Single Drop', category: 'Mechanisms', icon: 'cog' } },
        { id: 'k3', data: { name: 'Vec<u8> Move Example', category: 'Evidence', icon: 'file-text' } },
      ],
      [
        { id: 'e1', source: 'k1', target: 'k2', label: 'guarantees' },
        { id: 'e2', source: 'k2', target: 'k3', label: 'example of' },
      ],
      { mode: 'concept' },
    )
    expect(clean.score).toBe(100)
    expect(clean.rating).toBe('Well-Structured Concept Map')
    expect(clean.findings).toHaveLength(0)
  })
})
