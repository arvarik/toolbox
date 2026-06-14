import { useMemo } from 'react'
import { ArrowLeft, BarChart2, Calendar, ShieldAlert, Award } from 'lucide-react'

export default function StatsDashboard({ deck, onBack }) {
  const cards = deck.cards || []
  
  const stats = useMemo(() => {
    const total = cards.length
    
    // 1. States counts
    const newCount = cards.filter(c => (c.state || 0) === 0).length
    const learnCount = cards.filter(c => c.state === 1 || c.state === 3).length
    const reviewCount = cards.filter(c => c.state === 2).length

    // 2. Mastery / Mature count (Anki definition: interval >= 21 days)
    const matureCount = cards.filter(c => c.state === 2 && (c.interval || 0) >= 21).length
    const youngCount = cards.filter(c => c.state === 2 && (c.interval || 0) < 21).length
    const masteryPercentage = total > 0 ? Math.round((matureCount / total) * 100) : 0

    // 3. Ease factor distribution
    let easeSum = 0
    let easeCount = 0
    const easeBuckets = { low: 0, normal: 0, high: 0 } // < 2.0, 2.0-2.5, > 2.5
    
    cards.forEach(c => {
      if (c.repetitions > 0) {
        const ease = c.ease_factor || 2.5
        easeSum += ease
        easeCount++
        if (ease < 2.0) easeBuckets.low++
        else if (ease <= 2.5) easeBuckets.normal++
        else easeBuckets.high++
      }
    })
    const avgEase = easeCount > 0 ? (easeSum / easeCount).toFixed(2) : '2.50'

    // 4. Interval buckets
    const intervalBuckets = {
      new: newCount,
      learn: learnCount,
      days_1: 0,
      days_2_6: 0,
      days_7_14: 0,
      days_15_30: 0,
      days_30_plus: 0
    }

    cards.forEach(c => {
      if (c.state === 2) {
        const iv = c.interval || 0
        if (iv <= 1) intervalBuckets.days_1++
        else if (iv <= 6) intervalBuckets.days_2_6++
        else if (iv <= 14) intervalBuckets.days_7_14++
        else if (iv <= 30) intervalBuckets.days_15_30++
        else intervalBuckets.days_30_plus++
      }
    })

    return {
      total,
      newCount,
      learnCount,
      reviewCount,
      matureCount,
      youngCount,
      masteryPercentage,
      avgEase,
      easeBuckets,
      intervalBuckets
    }
  }, [cards])

  // Chart rendering helpers
  const maxIntervalCount = Math.max(...Object.values(stats.intervalBuckets), 1)
  const maxEaseCount = Math.max(stats.easeBuckets.low, stats.easeBuckets.normal, stats.easeBuckets.high, 1)

  return (
    <div style={{ padding: 'var(--space-6) var(--space-8)' }} id="stats-dashboard">
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 'var(--space-6)',
      }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>
          <ArrowLeft size={14} />
          {deck.name}
        </button>
        <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>Deck Statistics</h2>
        <div style={{ width: 80 }} /> {/* balance */}
      </div>

      {/* Summary Cards Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 'var(--space-4)',
        marginBottom: 'var(--space-8)'
      }}>
        <div className="card" style={{ padding: 'var(--space-4)', display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
          <div style={{ background: 'var(--color-info-subtle)', color: 'var(--color-info)', padding: 'var(--space-2)', borderRadius: 'var(--radius-md)' }}>
            <BarChart2 size={20} />
          </div>
          <div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>Total Cards</div>
            <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700 }}>{stats.total}</div>
          </div>
        </div>

        <div className="card" style={{ padding: 'var(--space-4)', display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
          <div style={{ background: 'var(--color-success-subtle)', color: 'var(--color-success)', padding: 'var(--space-2)', borderRadius: 'var(--radius-md)' }}>
            <Award size={20} />
          </div>
          <div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>Mature Cards (iv &ge; 21d)</div>
            <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700 }}>{stats.matureCount} <span style={{ fontSize: '12px', fontWeight: 400, color: 'var(--color-text-tertiary)' }}>({stats.masteryPercentage}%)</span></div>
          </div>
        </div>

        <div className="card" style={{ padding: 'var(--space-4)', display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
          <div style={{ background: 'var(--color-warning-subtle)', color: 'var(--color-warning)', padding: 'var(--space-2)', borderRadius: 'var(--radius-md)' }}>
            <Calendar size={20} />
          </div>
          <div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>Average Ease Factor</div>
            <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700 }}>{stats.avgEase} <span style={{ fontSize: '12px', fontWeight: 400, color: 'var(--color-text-tertiary)' }}>({stats.easeBuckets.low > 0 ? `${stats.easeBuckets.low} low` : 'healthy'})</span></div>
          </div>
        </div>
      </div>

      {/* Card Types Stacked Progress Bar */}
      <div className="card" style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-6)' }}>
        <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-4)' }}>Card State Breakdown</h3>
        <div style={{ height: 16, borderRadius: 'var(--radius-full)', overflow: 'hidden', display: 'flex', background: 'var(--color-surface-border)' }}>
          {stats.newCount > 0 && (
            <div style={{ width: `${(stats.newCount / stats.total) * 100}%`, background: 'var(--color-info)', height: '100%' }} title={`New: ${stats.newCount}`} />
          )}
          {stats.learnCount > 0 && (
            <div style={{ width: `${(stats.learnCount / stats.total) * 100}%`, background: 'var(--color-warning)', height: '100%' }} title={`Learning: ${stats.learnCount}`} />
          )}
          {stats.reviewCount > 0 && (
            <div style={{ width: `${(stats.reviewCount / stats.total) * 100}%`, background: 'var(--color-success)', height: '100%' }} title={`Review: ${stats.reviewCount}`} />
          )}
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-5)', marginTop: 'var(--space-4)', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-xs)' }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--color-info)' }} />
            <span style={{ color: 'var(--color-text-secondary)' }}>New: <strong>{stats.newCount}</strong> ({(stats.total > 0 ? (stats.newCount / stats.total) * 100 : 0).toFixed(0)}%)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-xs)' }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--color-warning)' }} />
            <span style={{ color: 'var(--color-text-secondary)' }}>Learning: <strong>{stats.learnCount}</strong> ({(stats.total > 0 ? (stats.learnCount / stats.total) * 100 : 0).toFixed(0)}%)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-xs)' }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--color-success)' }} />
            <span style={{ color: 'var(--color-text-secondary)' }}>Review / Graduated: <strong>{stats.reviewCount}</strong> ({(stats.total > 0 ? (stats.reviewCount / stats.total) * 100 : 0).toFixed(0)}%)</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--space-6)' }}>
        {/* Interval Distribution Chart */}
        <div className="card" style={{ padding: 'var(--space-5)' }}>
          <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-5)' }}>Interval Distribution</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {[
              { label: 'New', count: stats.intervalBuckets.new, color: 'var(--color-info)' },
              { label: 'Learn', count: stats.intervalBuckets.learn, color: 'var(--color-warning)' },
              { label: '1 day', count: stats.intervalBuckets.days_1, color: '#10b981' },
              { label: '2-6 days', count: stats.intervalBuckets.days_2_6, color: '#059669' },
              { label: '7-14 days', count: stats.intervalBuckets.days_7_14, color: '#047857' },
              { label: '15-30 days', count: stats.intervalBuckets.days_15_30, color: '#065f46' },
              { label: '31+ days', count: stats.intervalBuckets.days_30_plus, color: '#064e3b' }
            ].map(b => {
              const pct = stats.total > 0 ? (b.count / maxIntervalCount) * 100 : 0
              return (
                <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <div style={{ width: 80, fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', textAlign: 'right' }}>{b.label}</div>
                  <div style={{ flex: 1, height: 12, background: 'var(--color-surface-border)', borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: b.color, borderRadius: 6, transition: 'width 0.5s ease' }} />
                  </div>
                  <div style={{ width: 30, fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-primary)' }}>{b.count}</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Ease Factor Breakdown */}
        <div className="card" style={{ padding: 'var(--space-5)' }}>
          <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-5)' }}>Ease Factor Difficulty</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {[
              { label: 'Low Ease (< 2.0)', count: stats.easeBuckets.low, desc: 'Hard to remember cards', color: 'var(--color-error)' },
              { label: 'Normal Ease (2.0-2.5)', count: stats.easeBuckets.normal, desc: 'Average complexity cards', color: 'var(--color-warning)' },
              { label: 'High Ease (> 2.5)', count: stats.easeBuckets.high, desc: 'Easy to remember cards', color: 'var(--color-success)' }
            ].map(b => {
              const pct = stats.total > 0 ? (b.count / maxEaseCount) * 100 : 0
              return (
                <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <div style={{ width: 130, fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', textAlign: 'right' }}>
                    <div>{b.label}</div>
                  </div>
                  <div style={{ flex: 1, height: 12, background: 'var(--color-surface-border)', borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: b.color, borderRadius: 6, transition: 'width 0.5s ease' }} />
                  </div>
                  <div style={{ width: 30, fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-primary)' }}>{b.count}</div>
                </div>
              )
            })}
          </div>
          {stats.easeBuckets.low > 0 && (
            <div style={{ 
              marginTop: 'var(--space-6)',
              display: 'flex',
              gap: 'var(--space-3)',
              padding: 'var(--space-3)',
              background: 'rgba(239, 68, 68, 0.08)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-error)'
            }}>
              <ShieldAlert size={16} style={{ flexShrink: 0 }} />
              <div>
                <strong>Ease Factor Warning:</strong> You have {stats.easeBuckets.low} card(s) caught in "ease hell" (ease &lt; 2.0). 
                Consider rewriting their contents to be simpler or break them down into smaller concepts.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
