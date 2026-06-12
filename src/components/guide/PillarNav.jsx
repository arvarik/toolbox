import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { PILLARS } from '../../utils/constants'

/**
 * Left sidebar navigation listing the 5 pillars with collapsible topic lists.
 */
export default function PillarNav() {
  const { pillarId, topicId } = useParams()
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(
    pillarId ? { [pillarId]: true } : { compute: true }
  )
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 768 : false)

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
              return (
                <button
                  key={topic.id}
                  className={`mobile-topic-pill${isActive ? ' active' : ''}`}
                  onClick={() => handleTopicClick(activePillar, topic)}
                >
                  {topic.name}
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
                {pillar.topics.map((topic) => (
                  <button
                    key={topic.id}
                    className={`pillar-item${topicId === topic.id ? ' active' : ''}`}
                    onClick={() => handleTopicClick(pillar, topic)}
                    id={`topic-${topic.id}`}
                  >
                    {topic.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
