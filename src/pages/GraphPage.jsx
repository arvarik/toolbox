import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, Waypoints, Play, X, Loader2 } from 'lucide-react'
import useAppStore from '../stores/appStore'
import { graphApi } from '../utils/api'
import GraphCanvas from '../components/graph/GraphCanvas'
import NodePanel from '../components/graph/NodePanel'
import FlashcardView from '../components/study/FlashcardView'
import { HEALTH_COLORS, HEALTH_LABELS } from '../components/graph/graphLayout'
import { PILLARS } from '../utils/constants'

const READINESS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'ready', label: 'Ready to Learn' },
  { id: 'needs-review', label: 'Needs Review' },
  { id: 'mastered', label: 'Mastered' },
]

/**
 * The Knowledge Graph page (/graph): an interactive prerequisite map of
 * every system design concept, colored by live SM-2 memory health.
 */
export default function GraphPage() {
  const addToast = useAppStore((s) => s.addToast)
  const srsVersion = useAppStore((s) => s.srsVersion)

  const [graph, setGraph] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [readiness, setReadiness] = useState('all')
  const [pillarFilter, setPillarFilter] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [activeTrackId, setActiveTrackId] = useState('')
  const [session, setSession] = useState(null) // { cards, title }
  const [isStartingTrack, setIsStartingTrack] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const hasLoadedOnce = useRef(false)

  const fetchGraph = useCallback(async () => {
    try {
      const data = await graphApi.get()
      setGraph(data)
      setRefreshKey((k) => k + 1)
    } catch {
      if (!hasLoadedOnce.current) {
        addToast({ type: 'error', message: 'Failed to load the knowledge graph' })
      }
    } finally {
      hasLoadedOnce.current = true
      setIsLoading(false)
    }
  }, [addToast])

  // Load on mount; refresh whenever a card is graded anywhere in the
  // app (srsVersion) and when the window regains focus.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchGraph() }, [fetchGraph, srsVersion])
  useEffect(() => {
    const onFocus = () => fetchGraph()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [fetchGraph])

  const activeTrack = graph?.tracks?.find((t) => t.id === activeTrackId) || null

  const trackOrder = useMemo(() => {
    if (!activeTrack) return null
    const map = new Map()
    activeTrack.nodeIds.forEach((id, idx) => map.set(id, idx + 1))
    return map
  }, [activeTrack])

  /** Nodes that pass search + readiness + pillar + track filters. */
  const visibleIds = useMemo(() => {
    if (!graph) return null
    const term = search.trim().toLowerCase()
    const anyFilter = term || readiness !== 'all' || pillarFilter || activeTrack
    if (!anyFilter) return null

    const ids = new Set()
    for (const node of graph.nodes) {
      if (term && !node.name.toLowerCase().includes(term) && !node.summary.toLowerCase().includes(term)) continue
      if (pillarFilter && node.pillarId !== pillarFilter) continue
      if (activeTrack && !trackOrder.has(node.id)) continue
      if (readiness === 'ready' && !node.ready) continue
      if (readiness === 'needs-review' && node.health !== 'due' && node.health !== 'decayed') continue
      if (readiness === 'mastered' && node.health !== 'mastered') continue
      ids.add(node.id)
    }
    return ids
  }, [graph, search, readiness, pillarFilter, activeTrack, trackOrder])

  const startTrackSession = async () => {
    if (!activeTrack || isStartingTrack) return
    setIsStartingTrack(true)
    try {
      const data = await graphApi.trackSession(activeTrack.id)
      if (data?.cards?.length > 0) {
        setSession({ cards: data.cards, title: data.trackName })
      } else {
        addToast({ type: 'info', message: 'No studyable cards in this track right now — generate cards from the Guide first.' })
      }
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to start the track session' })
    } finally {
      setIsStartingTrack(false)
    }
  }

  const startNodeSession = (cards, title) => setSession({ cards, title })

  const closeSession = () => {
    setSession(null)
    fetchGraph()
  }

  if (isLoading) {
    return (
      <div className="graph-page" id="graph-page">
        <div className="graph-loading"><Loader2 size={20} className="spin" /> Building your knowledge graph…</div>
      </div>
    )
  }

  if (!graph) {
    return (
      <div className="graph-page" id="graph-page">
        <div className="graph-loading">
          Could not load the graph. <button className="btn btn-secondary btn-sm" onClick={fetchGraph}>Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="graph-page" id="graph-page">
      {/* Header + toolbar */}
      <div className="graph-header">
        <div className="graph-header-top">
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Waypoints size={22} style={{ color: 'var(--color-accent)' }} />
            Knowledge Graph
          </h1>
          <div className="graph-legend" aria-label="Legend">
            {Object.entries(HEALTH_LABELS).map(([key, label]) => (
              <span key={key} className="graph-legend-item">
                <span className="graph-health-dot" style={{ background: HEALTH_COLORS[key] }} />
                {label} <strong>{graph.stats[key] ?? 0}</strong>
              </span>
            ))}
          </div>
        </div>

        <div className="graph-toolbar">
          <div className="graph-search">
            <Search size={14} />
            <input
              className="graph-search-input"
              placeholder="Search concepts…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              id="graph-search"
            />
            {search && (
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setSearch('')} aria-label="Clear search">
                <X size={12} />
              </button>
            )}
          </div>

          <div className="graph-readiness" role="group" aria-label="Readiness filter">
            {READINESS_FILTERS.map((f) => (
              <button
                key={f.id}
                className={`graph-readiness-btn${readiness === f.id ? ' active' : ''}`}
                onClick={() => setReadiness(f.id)}
                id={`graph-filter-${f.id}`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <select
            className="graph-track-select"
            value={activeTrackId}
            onChange={(e) => { setActiveTrackId(e.target.value); setSelectedId(null) }}
            aria-label="Learning track"
            id="graph-track-select"
          >
            <option value="">🎯 Learning tracks…</option>
            {graph.tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.emoji} {t.name} ({t.masteredCount}/{t.nodeCount})
              </option>
            ))}
          </select>
        </div>

        <div className="graph-pillar-chips" role="group" aria-label="Pillar filter">
          {PILLARS.map((p) => (
            <button
              key={p.id}
              className={`graph-pillar-chip${pillarFilter === p.id ? ' active' : ''}`}
              style={{ '--chip-color': p.color }}
              onClick={() => setPillarFilter(pillarFilter === p.id ? null : p.id)}
            >
              {p.shortName}
            </button>
          ))}
        </div>
      </div>

      {/* Canvas + panel */}
      <div className="graph-body">
        <GraphCanvas
          nodes={graph.nodes}
          edges={graph.edges}
          visibleIds={visibleIds}
          trackOrder={trackOrder}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />

        {selectedId && (
          <NodePanel
            nodeId={selectedId}
            refreshKey={refreshKey}
            onClose={() => setSelectedId(null)}
            onSelectNode={setSelectedId}
            onStartSession={startNodeSession}
          />
        )}

        {/* Active track ribbon */}
        {activeTrack && (
          <div className="graph-track-ribbon" id="graph-track-ribbon">
            <div className="graph-track-ribbon-info">
              <span className="graph-track-ribbon-name">{activeTrack.emoji} {activeTrack.name}</span>
              <span className="graph-track-ribbon-desc">{activeTrack.description}</span>
              <span className="graph-track-ribbon-progress">
                {activeTrack.masteredCount}/{activeTrack.nodeCount} concepts mastered · numbered in study order
              </span>
            </div>
            <div className="graph-track-ribbon-actions">
              <button
                className="btn btn-primary btn-sm"
                onClick={startTrackSession}
                disabled={isStartingTrack}
                id="graph-start-track-btn"
              >
                {isStartingTrack ? <Loader2 size={13} className="spin" /> : <Play size={13} />}
                Start Track Session
              </button>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setActiveTrackId('')} aria-label="Close track">
                <X size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* In-graph study session */}
      {session && (
        <div className="graph-session-overlay" id="graph-session-overlay">
          <FlashcardView
            cards={session.cards}
            deckName={session.title}
            reviewMode
            onBack={closeSession}
          />
        </div>
      )}
    </div>
  )
}
