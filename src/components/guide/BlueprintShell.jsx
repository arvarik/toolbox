import { useParams, useNavigate } from 'react-router-dom'
import {
  Cpu, Scale, TrendingUp, Shield, Box,
  Radio, Target, Link, SlidersHorizontal,
  BookOpen,
} from 'lucide-react'
import { PILLARS, BLUEPRINT_SECTIONS } from '../../utils/constants'

const iconMap = {
  cpu: Cpu,
  scale: Scale,
  'trending-up': TrendingUp,
  shield: Shield,
  box: Box,
  radio: Radio,
  target: Target,
  link: Link,
  'sliders-horizontal': SlidersHorizontal,
  puzzle: Box,
}

/**
 * Blueprint content shell — displays section structure for a selected topic.
 * Content will be populated later from the data layer.
 */
export default function BlueprintShell() {
  const { pillarId, topicId } = useParams()
  const navigate = useNavigate()

  const pillar = PILLARS.find((p) => p.id === pillarId)
  const topic = pillar?.topics.find((t) => t.id === topicId)
  const sections = BLUEPRINT_SECTIONS[pillarId] || []

  // No pillar selected — show welcome
  if (!pillar) {
    return (
      <div className="empty-state" style={{ height: '100%' }}>
        <div className="empty-state-icon">
          <BookOpen size={24} />
        </div>
        <h3 className="empty-state-title">System Design Guide</h3>
        <p className="empty-state-description">
          Select a pillar from the sidebar to start exploring system design components, storage engines, protocols, and architectural paradigms.
        </p>
      </div>
    )
  }

  // Pillar selected but no topic
  if (!topic) {
    return (
      <div className="page-wrapper" style={{ padding: 'var(--space-8)' }}>
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
            <span
              className="badge"
              style={{ background: `${pillar.color}20`, color: pillar.color }}
            >
              Pillar {pillar.number}
            </span>
          </div>
          <h1 className="page-title">{pillar.name}</h1>
          <p className="page-description">
            Select a topic below to view its study blueprint.
          </p>
        </div>

        <div className="deck-grid">
          {pillar.topics.map((t) => (
            <div
              key={t.id}
              className="card card-interactive"
              onClick={() => navigate(`/guide/${pillar.id}/${t.id}`)}
              style={{ cursor: 'pointer' }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 'var(--radius-md)',
                  background: `${pillar.color}15`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 'var(--space-3)',
                }}
              >
                <Cpu size={18} style={{ color: pillar.color }} />
              </div>
              <div style={{ fontSize: 'var(--text-md)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>
                {t.name}
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
                {sections.length} blueprint sections
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Full blueprint view for selected topic
  return (
    <div className="page-wrapper" style={{ padding: 'var(--space-8)' }}>
      {/* Topic header */}
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
          <span
            className="badge"
            style={{ background: `${pillar.color}20`, color: pillar.color }}
          >
            Pillar {pillar.number} — {pillar.shortName}
          </span>
        </div>
        <h1 className="page-title">{topic.name}</h1>
        <p className="page-description">
          Study blueprint — deep dive into every dimension of this component.
        </p>
      </div>

      {/* Blueprint sections */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {sections.map((section) => {
          const Icon = iconMap[section.icon] || Cpu
          return (
            <div
              key={section.id}
              className="card"
              id={`blueprint-${section.id}`}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-4)' }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--color-accent-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Icon size={18} style={{ color: 'var(--color-accent)' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <h3 style={{ fontSize: 'var(--text-md)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
                    {section.name}
                  </h3>
                  <div
                    style={{
                      fontSize: 'var(--text-sm)',
                      color: 'var(--color-text-tertiary)',
                      lineHeight: 'var(--leading-relaxed)',
                      padding: 'var(--space-4)',
                      background: 'var(--color-bg-tertiary)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px dashed var(--color-border)',
                      minHeight: 60,
                    }}
                  >
                    Content for this section will be added here. Use the "Ask AI" chat to explore this topic.
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
