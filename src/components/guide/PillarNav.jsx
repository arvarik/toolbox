import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { PILLARS, BLUEPRINT_SECTIONS } from '../../utils/constants'
import { guideContentApi } from '../../utils/api'

/**
 * Left sidebar navigation listing the 7 pillars with collapsible topic lists.
 * Shows per-topic progress badges (filled section count / total sections).
 */
export default function PillarNav() {
  const { pillarId, topicId } = useParams()
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(
    pillarId ? { [pillarId]: true } : { compute: true }
  )
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 768 : false)

  // Progress data from the backend
  const [progress, setProgress] = useState({})

  useEffect(() => {
    guideContentApi.progress()
      .then((data) => setProgress(data || {}))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const toggleExpand = (id) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const handlePillarClick = (pillar) => {
    toggleExpand(pillar.id)
    navigate(`/guide/${pillar.id}`)
  }

  const handleTopicClick = (pillar, topic) => {
    navigate(`/guide/${pillar.id}/${topic.id}`)
  }

  // Returns { filled, total } for a topic
  const getTopicProgress = (pillarId, topicId) => {
    const sections = BLUEPRINT_SECTIONS[pillarId] || []
    const filled = sections.filter((s) => progress[`${pillarId}__${topicId}__${s.id}`]).length
    return { filled, total: sections.length }
  }

  if (isMobile) {
    const activePillar = PILLARS.find((p) => p.id === (pillarId || 'compute')) || PILLARS[0]

    return (
      <div className="mobile-pillar-nav" id="guide-pillar-nav">
        <div className="mobile-pillars-scroll">
          {PILLARS.map((pillar) => {
            const isActive = pillarId === pillar.id || (!pillarId && pillar.id === 'compute')
            return (
              <button
                key={pillar.id}
                className={`mobile-pillar-pill${isActive ? ' active' : ''}`}
                onClick={() => handlePillarClick(pillar)}
                style={{
                  borderLeft: `3px solid ${pillar.color}`,
                }}
              >
                <span className="pillar-number" style={{ background: `${pillar.color}20`, color: pillar.color }}>
                  {pillar.number}
                </span>
                <span>{pillar.shortName}</span>
              </button>
            )
          })}
        </div>

        {activePillar && (
          <div className="mobile-topics-scroll">
            {activePillar.topics.map((topic) => {
              const isActive = topicId === topic.id
              const { filled, total } = getTopicProgress(activePillar.id, topic.id)
              const complete = filled === total && total > 0
              return (
                <button
                  key={topic.id}
                  className={`mobile-topic-pill${isActive ? ' active' : ''}`}
                  onClick={() => handleTopicClick(activePillar, topic)}
                >
                  <span style={{ flex: 1, textAlign: 'left' }}>{topic.name}</span>
                  {filled > 0 && (
                    <span style={{
                      fontSize: '10px', fontWeight: 700,
                      color: complete ? '#22c55e' : 'var(--color-accent)',
                      marginLeft: 4,
                    }}>
                      {filled}/{total}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="guide-sidebar" id="guide-pillar-nav">
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <div
          style={{
            fontSize: 'var(--text-xs)',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-wide)',
            color: 'var(--color-text-tertiary)',
            padding: '0 var(--space-3) var(--space-3)',
          }}
        >
          Pillars
        </div>
      </div>

      {PILLARS.map((pillar) => {
        const isExpanded = expanded[pillar.id]
        const isPillarActive = pillarId === pillar.id

        return (
          <div className="pillar-group" key={pillar.id}>
            <button
              className={`pillar-group-header${isPillarActive ? ' active' : ''}`}
              onClick={() => handlePillarClick(pillar)}
              id={`pillar-${pillar.id}`}
            >
              <span className="pillar-number" style={{ background: `${pillar.color}20`, color: pillar.color }}>
                {pillar.number}
              </span>
              <span style={{ flex: 1, textAlign: 'left' }}>{pillar.shortName}</span>
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>

            {isExpanded && (
              <div className="pillar-group-items">
                {pillar.topics.map((topic) => {
                  const isTopicActive = topicId === topic.id
                  const { filled, total } = getTopicProgress(pillar.id, topic.id)
                  const complete = filled === total && total > 0

                  return (
                    <button
                      key={topic.id}
                      className={`pillar-item${isTopicActive ? ' active' : ''}`}
                      onClick={() => handleTopicClick(pillar, topic)}
                      id={`topic-${topic.id}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}
                    >
                      <span style={{ flex: 1, textAlign: 'left' }}>{topic.name}</span>
                      {/* Progress badge */}
                      {filled > 0 && (
                        <span style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          color: complete ? '#22c55e' : 'var(--color-accent)',
                          background: complete ? 'rgba(34,197,94,0.12)' : 'var(--color-accent-subtle)',
                          padding: '1px 6px',
                          borderRadius: 'var(--radius-full)',
                          flexShrink: 0,
                        }}>
                          {filled}/{total}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
