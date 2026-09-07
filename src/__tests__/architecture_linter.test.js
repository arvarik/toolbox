import { describe, it, expect } from 'vitest'
import { auditArchitecture } from '../utils/architectureLinter'

describe('Architecture Linter Engine', () => {
  it('handles empty canvas safely', () => {
    const report = auditArchitecture([], [])
    expect(report.score).toBe(100)
    expect(report.rating).toBe('Empty Canvas')
    expect(report.findings).toHaveLength(0)
    expect(report.stats.totalNodes).toBe(0)
  })

  it('detects orphan / disconnected components', () => {
    const nodes = [
      { id: 'app-1', data: { name: 'App Server', category: 'Compute', icon: 'box' } },
      { id: 'db-1', data: { name: 'Postgres', category: 'Storage', icon: 'database' } },
    ]
    const edges = [] // no connection

    const report = auditArchitecture(nodes, edges)
    const orphanFinding = report.findings.find((f) => f.id === 'orphan-components')
    expect(orphanFinding).toBeDefined()
    expect(orphanFinding.severity).toBe('warning')
  })

  it('flags unshielded direct client ingress as critical', () => {
    const nodes = [
      { id: 'client-1', data: { name: 'Web Client', category: 'Clients', icon: 'monitor' } },
      { id: 'app-1', data: { name: 'Microservice', category: 'Compute', icon: 'box' } },
    ]
    const edges = [
      { id: 'e1', source: 'client-1', target: 'app-1' },
    ]

    const report = auditArchitecture(nodes, edges)
    const ingressFinding = report.findings.find((f) => f.id === 'unshielded-ingress')
    expect(ingressFinding).toBeDefined()
    expect(ingressFinding.severity).toBe('critical')
  })

  it('passes ingress check when API Gateway is in front of backend', () => {
    const nodes = [
      { id: 'client-1', data: { name: 'Web Client', category: 'Clients', icon: 'monitor' } },
      { id: 'gw-1', data: { name: 'API Gateway', category: 'Compute', icon: 'door-open' } },
      { id: 'app-1', data: { name: 'Microservice', category: 'Compute', icon: 'box' } },
    ]
    const edges = [
      { id: 'e1', source: 'client-1', target: 'gw-1' },
      { id: 'e2', source: 'gw-1', target: 'app-1' },
    ]

    const report = auditArchitecture(nodes, edges)
    const ingressFinding = report.findings.find((f) => f.id === 'unshielded-ingress')
    expect(ingressFinding).toBeUndefined()
    expect(report.passes.some((p) => p.includes('Perimeter Shield'))).toBe(true)
  })

  it('detects compute SPOF when only 1 app instance exists without LB', () => {
    const nodes = [
      { id: 'app-1', data: { name: 'Single Server', category: 'Compute', icon: 'box' } },
    ]
    const edges = []

    const report = auditArchitecture(nodes, edges)
    const spof = report.findings.find((f) => f.id === 'compute-spof')
    expect(spof).toBeDefined()
    expect(spof.severity).toBe('critical')
  })

  it('detects missing cache tier when persistent DB is queried directly', () => {
    const nodes = [
      { id: 'app-1', data: { name: 'Backend', category: 'Compute', icon: 'box' } },
      { id: 'db-1', data: { name: 'SQL Database', category: 'Storage', icon: 'database' } },
    ]
    const edges = [
      { id: 'e1', source: 'app-1', target: 'db-1' },
    ]

    const report = auditArchitecture(nodes, edges)
    const cacheFinding = report.findings.find((f) => f.id === 'missing-cache-tier')
    expect(cacheFinding).toBeDefined()
    expect(cacheFinding.severity).toBe('warning')
  })

  it('detects unbuffered writes to database without a queue', () => {
    const nodes = [
      { id: 'app-1', data: { name: 'Backend', category: 'Compute', icon: 'box' } },
      { id: 'db-1', data: { name: 'SQL Database', category: 'Storage', icon: 'database' } },
    ]
    const edges = [
      { id: 'e1', source: 'app-1', target: 'db-1' },
    ]

    const report = auditArchitecture(nodes, edges)
    const writeFinding = report.findings.find((f) => f.id === 'unbuffered-writes')
    expect(writeFinding).toBeDefined()
    expect(writeFinding.severity).toBe('warning')
  })

  it('passes write buffering when message queue is present', () => {
    const nodes = [
      { id: 'app-1', data: { name: 'Backend', category: 'Compute', icon: 'box' } },
      { id: 'queue-1', data: { name: 'Message Queue', category: 'Compute', icon: 'mail' } },
      { id: 'db-1', data: { name: 'SQL Database', category: 'Storage', icon: 'database' } },
    ]
    const edges = [
      { id: 'e1', source: 'app-1', target: 'queue-1' },
      { id: 'e2', source: 'queue-1', target: 'db-1' },
    ]

    const report = auditArchitecture(nodes, edges)
    const writeFinding = report.findings.find((f) => f.id === 'unbuffered-writes')
    expect(writeFinding).toBeUndefined()
    expect(report.passes.some((p) => p.includes('Decoupled Asynchrony'))).toBe(true)
  })

  it('calculates score and rating accurately', () => {
    // Robust architecture
    const nodes = [
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
    const edges = [
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
})
