import { Trophy, Clock, Brain, Target, ArrowLeft } from 'lucide-react'

/**
 * StudySessionSummary — displayed after completing a study/review session.
 * Shows performance metrics: total cards, accuracy, time, and streak info.
 */
export default function StudySessionSummary({ stats, onBack, onStudyAgain }) {
  const { totalCards, correctCards, totalTimeMs, ratings } = stats
  const accuracy = totalCards > 0 ? Math.round((correctCards / totalCards) * 100) : 0
  const avgTimePerCard = totalCards > 0 ? Math.round(totalTimeMs / totalCards / 1000) : 0
  const totalTimeSec = Math.round(totalTimeMs / 1000)
  const minutes = Math.floor(totalTimeSec / 60)
  const seconds = totalTimeSec % 60

  // Rating distribution
  const ratingLabels = ['Again', 'Hard', '', '', 'Good', 'Easy']
  const ratingColors = ['var(--color-error)', 'var(--color-warning)', '', '', 'var(--color-success)', 'var(--color-info)']

  return (
    <div className="session-summary" id="study-session-summary">
      {/* Hero */}
      <div className="session-summary-hero">
        <div className="session-summary-trophy">
          <Trophy size={32} style={{ color: 'var(--color-warning)' }} />
        </div>
        <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, marginTop: 'var(--space-3)' }}>
          Session Complete!
        </h2>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
          Great work! Here's how you did.
        </p>
      </div>

      {/* Stats grid */}
      <div className="session-stats-grid">
        <div className="session-stat-card">
          <div className="session-stat-icon" style={{ background: 'var(--color-accent-subtle)' }}>
            <Brain size={18} style={{ color: 'var(--color-accent)' }} />
          </div>
          <div className="session-stat-value">{totalCards}</div>
          <div className="session-stat-label">Cards Studied</div>
        </div>

        <div className="session-stat-card">
          <div className="session-stat-icon" style={{ background: 'var(--color-success-subtle)' }}>
            <Target size={18} style={{ color: 'var(--color-success)' }} />
          </div>
          <div className="session-stat-value">{accuracy}%</div>
          <div className="session-stat-label">Accuracy</div>
        </div>

        <div className="session-stat-card">
          <div className="session-stat-icon" style={{ background: 'var(--color-info-subtle)' }}>
            <Clock size={18} style={{ color: 'var(--color-info)' }} />
          </div>
          <div className="session-stat-value">
            {minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`}
          </div>
          <div className="session-stat-label">Total Time</div>
        </div>

        <div className="session-stat-card">
          <div className="session-stat-icon" style={{ background: 'var(--color-warning-subtle)' }}>
            <Clock size={18} style={{ color: 'var(--color-warning)' }} />
          </div>
          <div className="session-stat-value">{avgTimePerCard}s</div>
          <div className="session-stat-label">Avg per Card</div>
        </div>
      </div>

      {/* Rating distribution */}
      {ratings && Object.keys(ratings).length > 0 && (
        <div className="session-rating-dist">
          <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-3)' }}>
            Rating Distribution
          </h3>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end', height: 60 }}>
            {[0, 3, 4, 5].map((q) => {
              const count = ratings[q] || 0
              const maxCount = Math.max(...[0, 3, 4, 5].map((r) => ratings[r] || 0), 1)
              const height = totalCards > 0 ? Math.max((count / maxCount) * 50, 4) : 4
              const idx = q
              return (
                <div key={q} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, gap: 4 }}>
                  <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>{count}</span>
                  <div
                    style={{
                      width: '100%',
                      height,
                      borderRadius: 'var(--radius-sm)',
                      background: ratingColors[idx] || 'var(--color-accent)',
                      transition: 'height 0.3s ease',
                    }}
                  />
                  <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>
                    {ratingLabels[idx] || q}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center', marginTop: 'var(--space-6)' }}>
        <button className="btn btn-secondary" onClick={onBack}>
          <ArrowLeft size={14} />
          Back to Decks
        </button>
        {onStudyAgain && (
          <button className="btn btn-primary" onClick={onStudyAgain}>
            <Brain size={14} />
            Study Again
          </button>
        )}
      </div>
    </div>
  )
}
