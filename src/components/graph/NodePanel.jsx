import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  X, BookOpen, PenTool, GraduationCap, Loader2, Lock,
  ArrowUpLeft, ArrowDownRight, Layers, Calculator, Wrench,
} from 'lucide-react'
import { graphApi } from '../../utils/api'
import { HEALTH_COLORS, HEALTH_LABELS } from './graphLayout'

const STATE_LABELS = { 0: 'New', 1: 'Learning', 2: 'Review', 3: 'Relearning' }

function HealthDot({ health }) {
  return (
    <span
      className="graph-health-dot"
      style={{ background: HEALTH_COLORS[health] || HEALTH_COLORS.unseen }}
      aria-label={HEALTH_LABELS[health]}
    />
  )
}

/**
 * Slide-over panel for a selected graph node. Deep links into the Guide
 * blueprint, related whiteboards, and the node's flashcards, and starts
 * a focused study session for the node's due cards.
 *
 * @param {string} nodeId
 * @param {Function} onClose
 * @param {Function} onSelectNode - Jump to a prerequisite/dependent node.
 * @param {Function} onStartSession - (cards, title) => void
 * @param {number} refreshKey - Bumps to refetch after grading.
 */
export default function NodePanel({ nodeId, onClose, onSelectNode, onStartSession, refreshKey }) {
  const [detail, setDetail] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isStarting, setIsStarting] = useState(false)

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true)
    graphApi.getNode(nodeId)
      .then((data) => { if (!cancelled) setDetail(data) })
      .catch(() => { if (!cancelled) setDetail(null) })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [nodeId, refreshKey])

  const startSession = async () => {
    if (isStarting) return
    setIsStarting(true)
    try {
      const session = await graphApi.nodeSession(nodeId)
      if (session?.cards?.length > 0) {
        onStartSession(session.cards, session.nodeName)
      }
    } finally {
      setIsStarting(false)
    }
  }

  const studyableCount = detail?.cards?.filter((c) => c.due).length || 0

  return (
    <aside className="graph-node-panel" id="graph-node-panel" aria-label="Concept details">
      <button className="btn btn-ghost btn-icon graph-panel-close" onClick={onClose} aria-label="Close panel">
        <X size={16} />
      </button>

      {isLoading && (
        <div className="graph-panel-loading"><Loader2 size={18} className="spin" /></div>
      )}

      {!isLoading && !detail && (
        <p style={{ color: 'var(--color-text-tertiary)', padding: 'var(--space-4)' }}>
          Failed to load this concept. Try again.
        </p>
      )}

      {!isLoading && detail && (
        <>
          <div className="graph-panel-header">
            <span className="graph-panel-pillar" style={{ color: detail.node.pillarColor || 'var(--color-accent)' }}>
              {detail.node.pillarName || detail.node.pillarId}
            </span>
            <h2 className="graph-panel-title">{detail.node.name}</h2>
            <div className="graph-panel-health">
              <HealthDot health={detail.node.health} />
              <span>{HEALTH_LABELS[detail.node.health]}</span>
              {detail.node.locked && (
                <span className="graph-panel-locked" title="Prerequisites not solid yet">
                  <Lock size={11} /> Prerequisites first
                </span>
              )}
            </div>
            <div className="graph-strength-track" title={`Memory strength ${Math.round(detail.node.strength * 100)}%`}>
              <div
                className="graph-strength-fill"
                style={{
                  width: `${Math.round(detail.node.strength * 100)}%`,
                  background: HEALTH_COLORS[detail.node.health],
                }}
              />
            </div>
            <p className="graph-panel-summary">{detail.node.summary}</p>
          </div>

          {/* Actions */}
          <div className="graph-panel-actions">
            <button
              className="btn btn-primary btn-sm"
              onClick={startSession}
              disabled={isStarting || studyableCount === 0}
              title={studyableCount > 0 ? `Review the ${studyableCount} studyable card(s) for this concept` : 'No cards ready to study'}
              id="graph-study-node-btn"
            >
              {isStarting ? <Loader2 size={13} className="spin" /> : <GraduationCap size={13} />}
              Study {studyableCount > 0 ? `${studyableCount} card${studyableCount === 1 ? '' : 's'}` : 'cards'}
            </button>
            {detail.guide && (
              <Link className="btn btn-secondary btn-sm" to={`/guide/${detail.guide.pillarId}/${detail.guide.topicId}`}>
                <BookOpen size={13} />
                Guide: {detail.guide.topicName}
                {detail.guide.filledSections > 0 && (
                  <span className="graph-panel-badge">{detail.guide.filledSections} notes</span>
                )}
              </Link>
            )}
            {detail.node.id === 'capacity-estimation' && (
              <Link className="btn btn-secondary btn-sm" to="/calculator">
                <Calculator size={13} /> Open BotE Calculator
              </Link>
            )}
            {detail.boards.map((board) => (
              <Link key={board.id} className="btn btn-secondary btn-sm" to={`/builder?board=${board.id}`}>
                <PenTool size={13} /> {board.name}
              </Link>
            ))}
          </div>

          {/* Prerequisites */}
          {detail.prereqs.length > 0 && (
            <div className="graph-panel-section">
              <div className="graph-panel-section-title">
                <ArrowUpLeft size={12} /> Learn first
              </div>
              {detail.prereqs.map((p) => (
                <button key={p.id} className="graph-panel-node-link" onClick={() => onSelectNode(p.id)}>
                  <HealthDot health={p.health} />
                  <span>{p.name}</span>
                </button>
              ))}
            </div>
          )}

          {/* Dependents */}
          {detail.dependents.length > 0 && (
            <div className="graph-panel-section">
              <div className="graph-panel-section-title">
                <ArrowDownRight size={12} /> Unlocks
              </div>
              {detail.dependents.map((d) => (
                <button key={d.id} className="graph-panel-node-link" onClick={() => onSelectNode(d.id)}>
                  <HealthDot health={d.health} />
                  <span>{d.name}</span>
                </button>
              ))}
            </div>
          )}

          {/* Linked flashcards */}
          <div className="graph-panel-section">
            <div className="graph-panel-section-title">
              <Layers size={12} /> Flashcards ({detail.cards.length})
            </div>
            {detail.cards.length === 0 && (
              <p className="graph-panel-empty">
                No cards yet. Generate some from the Guide or Chat — they link here automatically by concept.
              </p>
            )}
            {detail.cards.slice(0, 8).map((card) => (
              <div key={card.id} className="graph-panel-card">
                {card.remediation && (
                  <span className="graph-panel-remediation" title="Queued as a foundational checkup">
                    <Wrench size={10} />
                  </span>
                )}
                <span className="graph-panel-card-front">{card.front}</span>
                <span className={`graph-panel-card-state s${card.state}${card.due ? ' due' : ''}`}>
                  {card.due && card.state !== 0 ? 'Due' : STATE_LABELS[card.state]}
                </span>
              </div>
            ))}
            {detail.cards.length > 8 && (
              <p className="graph-panel-empty">+ {detail.cards.length - 8} more</p>
            )}
          </div>
        </>
      )}
    </aside>
  )
}
