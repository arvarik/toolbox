import { useState, useEffect } from 'react'
import { CheckCircle2, Circle, ChevronRight, ChevronDown, BookOpen, Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { BLUEPRINT_SECTIONS, PILLARS } from '../../utils/constants'

import { guideContentApi } from '../../utils/api'
import Skeleton from '../shared/Skeleton'

/**
 * LearningTodo — smart to-do list showing unfilled guide sections.
 * Shows progress per pillar/topic and lets users start focused study sessions.
 *
 * @param {Object} props
 * @param {Function} props.onStudyTopic - Called with (pillar, topic, seedPrompt) when user starts studying a topic
 */
export default function LearningTodo({ onStudyTopic }) {
  const [progress, setProgress] = useState({}) // { 'pillarId__topicId__sectionId': true }
  const [isLoading, setIsLoading] = useState(true)
  const [expandedPillars, setExpandedPillars] = useState({})
  const navigate = useNavigate()

  useEffect(() => {
    guideContentApi.progress()
      .then((data) => setProgress(data || {}))
      .catch(() => setProgress({}))
      .finally(() => setIsLoading(false))
  }, [])

  const togglePillar = (pillarId) => {
    setExpandedPillars((prev) => ({ ...prev, [pillarId]: !prev[pillarId] }))
  }

  // Compute totals
  const totalSections = PILLARS.reduce((acc, p) => {
    const sections = BLUEPRINT_SECTIONS[p.id] || []
    return acc + p.topics.length * sections.length
  }, 0)

  const filledSections = Object.keys(progress).length

  const overallPercent = totalSections > 0
    ? Math.round((filledSections / totalSections) * 100)
    : 0

  // Find the first incomplete topic to highlight as "Start Here"
  let suggestedTopic = null
  let suggestedPillar = null
  outer: for (const pillar of PILLARS) {
    const sections = BLUEPRINT_SECTIONS[pillar.id] || []
    for (const topic of pillar.topics) {
      const filledCount = sections.filter(
        (s) => progress[`${pillar.id}__${topic.id}__${s.id}`]
      ).length
      if (filledCount < sections.length) {
        suggestedTopic = topic
        suggestedPillar = pillar
        break outer
      }
    }
  }

  return (
    <div className="learning-todo" id="learning-todo">
      {/* Header */}
      <div className="learning-todo-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
          <BookOpen size={15} style={{ color: 'var(--color-accent)' }} />
          <span style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>Guide Progress</span>
        </div>

        {/* Overall progress bar */}
        <div style={{ marginBottom: 'var(--space-3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-1)' }}>
            <span>{filledSections} of {totalSections} sections filled</span>
            <span style={{ fontWeight: 600, color: overallPercent > 0 ? 'var(--color-accent)' : 'var(--color-text-tertiary)' }}>
              {overallPercent}%
            </span>
          </div>
          <div style={{
            height: 4, background: 'var(--color-bg-tertiary)',
            borderRadius: 'var(--radius-full)', overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${overallPercent}%`,
              background: 'linear-gradient(90deg, var(--color-accent), var(--color-accent-hover, var(--color-accent)))',
              borderRadius: 'var(--radius-full)',
              transition: 'width 0.4s ease',
            }} />
          </div>
        </div>

        {/* AI suggestion */}
        {suggestedTopic && suggestedPillar && (
          <div
            style={{
              background: 'var(--color-accent-subtle)',
              border: '1px solid var(--color-accent)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-3)',
              cursor: 'pointer',
            }}
            onClick={() => {
              onStudyTopic?.(suggestedPillar, suggestedTopic)
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', marginBottom: 'var(--space-1)' }}>
              <Sparkles size={11} style={{ color: 'var(--color-accent)' }} />
              <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-accent)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Start Here
              </span>
            </div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-primary)', lineHeight: 1.3 }}>
              {suggestedTopic.name}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
              {suggestedPillar.name}
            </div>
          </div>
        )}
      </div>

      {/* Pillar list */}
      <div className="learning-todo-list">
        {isLoading ? (
          <div style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} style={{ height: 36 }} />
            ))}
          </div>
        ) : (
          PILLARS.map((pillar) => {
            const sections = BLUEPRINT_SECTIONS[pillar.id] || []
            const isExpanded = expandedPillars[pillar.id]

            const pillarFilled = pillar.topics.reduce((acc, topic) => {
              return acc + sections.filter((s) => progress[`${pillar.id}__${topic.id}__${s.id}`]).length
            }, 0)
            const pillarTotal = pillar.topics.length * sections.length
            const pillarPercent = pillarTotal > 0 ? Math.round((pillarFilled / pillarTotal) * 100) : 0
            const pillarComplete = pillarFilled === pillarTotal && pillarTotal > 0

            return (
              <div key={pillar.id} className="todo-pillar-group">
                <button
                  className="todo-pillar-header"
                  onClick={() => togglePillar(pillar.id)}
                  style={{ '--pillar-color': pillar.color }}
                >
                  <span style={{
                    width: 20, height: 20, borderRadius: 'var(--radius-sm)', flexShrink: 0,
                    background: `${pillar.color}20`, color: pillar.color,
                    fontSize: '10px', fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {pillar.number}
                  </span>
                  <span style={{ flex: 1, textAlign: 'left', fontSize: 'var(--text-xs)', fontWeight: 600 }}>
                    {pillar.shortName}
                  </span>
                  <span style={{
                    fontSize: '10px',
                    color: pillarComplete ? '#22c55e' : 'var(--color-text-tertiary)',
                    fontWeight: pillarComplete ? 700 : 400,
                    marginRight: 'var(--space-1)',
                  }}>
                    {pillarPercent}%
                  </span>
                  {isExpanded ? <ChevronDown size={12} style={{ flexShrink: 0 }} /> : <ChevronRight size={12} style={{ flexShrink: 0 }} />}
                </button>

                {isExpanded && (
                  <div className="todo-topics">
                    {pillar.topics.map((topic) => {
                      const filledCount = sections.filter(
                        (s) => progress[`${pillar.id}__${topic.id}__${s.id}`]
                      ).length
                      const topicComplete = filledCount === sections.length && sections.length > 0
                      const hasAny = filledCount > 0

                      return (
                        <div key={topic.id} className="todo-topic-item">
                          <div
                            className="todo-topic-row"
                            onClick={() => {
                              onStudyTopic?.(pillar, topic)
                            }}
                          >
                            <div style={{ flexShrink: 0, marginTop: 1 }}>
                              {topicComplete
                                ? <CheckCircle2 size={13} style={{ color: '#22c55e' }} />
                                : hasAny
                                  ? <Circle size={13} style={{ color: 'var(--color-accent)' }} strokeWidth={2.5} />
                                  : <Circle size={13} style={{ color: 'var(--color-text-tertiary)' }} />
                              }
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{
                                fontSize: '12px', fontWeight: 500,
                                color: topicComplete ? 'var(--color-text-secondary)' : 'var(--color-text-primary)',
                                textDecoration: topicComplete ? 'line-through' : 'none',
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                              }}>
                                {topic.name}
                              </div>
                              <div style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', marginTop: 1 }}>
                                {filledCount}/{sections.length} sections
                              </div>
                            </div>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                navigate(`/guide/${pillar.id}/${topic.id}`)
                              }}
                              title="View in Guide"
                              style={{ fontSize: '10px', padding: '2px 6px', color: 'var(--color-text-tertiary)', flexShrink: 0 }}
                            >
                              View
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
