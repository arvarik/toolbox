import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Bookmark, ChevronRight, ChevronDown } from 'lucide-react'
import type { Pillar } from '../../../shared/kits/kitSkeleton'
import { SegmentedControl } from '../ui'
import { guideContentApi, type GuideDogearItem } from '../../utils/api'
import { useActiveKit, useKitRoutePrefix } from '../../stores/useKitStore'
import useIsMobile from '../../hooks/useIsMobile'

interface PillarNavProps {
  dogears?: GuideDogearItem[]
}

type FilterMode = 'all' | 'dogeared'

/**
 * Left curriculum spine for the Guide listing the active Kit's pillars,
 * per-topic progress counts, and an All / Dogeared page filter.
 */
export default function PillarNav({ dogears: controlledDogears }: PillarNavProps = {}) {
  const { pillarId, topicId } = useParams()
  const navigate = useNavigate()
  const { kitSlug, pillars, sectionsByPillar } = useActiveKit()
  const prefix = useKitRoutePrefix()
  const defaultPillarId = pillars[0]?.id || 'compute'

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => ({
    [pillarId || defaultPillarId]: true,
  }))
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const isMobile = useIsMobile()

  const [progress, setProgress] = useState<Record<string, boolean>>({})
  const [localDogears, setLocalDogears] = useState<GuideDogearItem[]>([])

  const effectiveDogears = controlledDogears ?? localDogears

  const fetchProgress = useCallback(() => {
    Promise.resolve(guideContentApi?.progress?.())
      .then((data) => setProgress((data as Record<string, boolean> | null) || {}))
      .catch(() => {})
  }, [])

  const fetchLocalDogears = useCallback(() => {
    if (controlledDogears !== undefined) return
    Promise.resolve(guideContentApi?.listDogears?.())
      .then((items) => setLocalDogears(Array.isArray(items) ? items : []))
      .catch(() => setLocalDogears([]))
  }, [controlledDogears])

  useEffect(() => {
    fetchProgress()
    fetchLocalDogears()
    window.addEventListener('guide-progress-updated', fetchProgress)
    window.addEventListener('guide-dogears-updated', fetchLocalDogears)
    return () => {
      window.removeEventListener('guide-progress-updated', fetchProgress)
      window.removeEventListener('guide-dogears-updated', fetchLocalDogears)
    }
  }, [prefix, kitSlug, fetchProgress, fetchLocalDogears])

  useEffect(() => {
    setExpanded((prev) => ({
      ...prev,
      [pillarId || defaultPillarId]: true,
    }))
  }, [prefix, kitSlug, defaultPillarId, pillarId])

  const toggleExpand = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const handlePillarClick = (pillar: Pillar) => {
    toggleExpand(pillar.id)
    navigate(`${prefix}/guide/${pillar.id}`)
  }

  const handleTopicClick = (pillar: Pillar, topic: Pillar['topics'][number]) => {
    navigate(`${prefix}/guide/${pillar.id}/${topic.id}`)
  }

  const getTopicProgress = (pId: string, tId: string) => {
    const sections = sectionsByPillar[pId] || []
    const filled = sections.filter((s) => progress[`${pId}__${tId}__${s.id}`]).length
    return { filled, total: sections.length }
  }

  const dogearedTopicKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const d of effectiveDogears) {
      if (d.pillarId && d.topicId) {
        keys.add(`${d.pillarId}__${d.topicId}`)
      }
    }
    return keys
  }, [effectiveDogears])

  const dogearedTopicCount = useMemo(() => {
    let count = 0
    for (const p of pillars) {
      for (const t of p.topics) {
        if (dogearedTopicKeys.has(`${p.id}__${t.id}`)) count += 1
      }
    }
    return count
  }, [pillars, dogearedTopicKeys])

  const isTopicDogeared = (pId: string, tId: string) =>
    dogearedTopicKeys.has(`${pId}__${tId}`)

  if (isMobile) {
    const activePillar =
      pillars.find((p) => p.id === (pillarId || defaultPillarId)) || pillars[0]

    const mobileTopics =
      filterMode === 'dogeared'
        ? pillars.flatMap((p) =>
            p.topics
              .filter((t) => isTopicDogeared(p.id, t.id))
              .map((t) => ({ pillar: p, topic: t })),
          )
        : (activePillar?.topics || []).map((t) => ({ pillar: activePillar, topic: t }))

    return (
      <div
        className="mobile-pillar-nav border-b border-[var(--color-line)] bg-[var(--color-surface-low)]"
        id="guide-pillar-nav"
      >
        <div className="px-3 pt-2">
          <SegmentedControl
            size="xs"
            ariaLabel="Filter guide pages"
            value={filterMode}
            onChange={setFilterMode}
            items={[
              { value: 'all', label: 'All' },
              {
                value: 'dogeared',
                label: 'Dogeared',
                badge: dogearedTopicCount > 0 ? dogearedTopicCount : undefined,
              },
            ]}
          />
        </div>

        {filterMode === 'all' && (
          <div className="mobile-pillars-scroll">
            {pillars.map((pillar) => {
              const isActive =
                pillarId === pillar.id || (!pillarId && pillar.id === defaultPillarId)
              return (
                <button
                  key={pillar.id}
                  type="button"
                  className={`mobile-pillar-pill${isActive ? ' active' : ''}`}
                  onClick={() => handlePillarClick(pillar)}
                >
                  <span className="pillar-number bg-[var(--color-surface-elevated)] font-mono text-[var(--color-ink-muted)] tabular-nums">
                    {pillar.number}
                  </span>
                  <span>{pillar.shortName}</span>
                </button>
              )
            })}
          </div>
        )}

        <div className="mobile-topics-scroll">
          {mobileTopics.length === 0 && filterMode === 'dogeared' ? (
            <span className="px-2 py-1 text-[12px] text-[var(--color-ink-faint)]">
              No dogeared pages yet.
            </span>
          ) : (
            mobileTopics.map(({ pillar, topic }) => {
              const isActive = topicId === topic.id && pillarId === pillar.id
              const { filled, total } = getTopicProgress(pillar.id, topic.id)
              const dogeared = isTopicDogeared(pillar.id, topic.id)
              return (
                <button
                  key={`${pillar.id}-${topic.id}`}
                  type="button"
                  className={`mobile-topic-pill${isActive ? ' active' : ''}`}
                  onClick={() => handleTopicClick(pillar, topic)}
                >
                  <span className="flex-1 text-left">{topic.name}</span>
                  {dogeared && (
                    <Bookmark
                      size={11}
                      className={`ml-1 shrink-0 ${
                        isActive
                          ? 'fill-current text-current'
                          : 'fill-[var(--color-brand)] text-[var(--color-brand)]'
                      }`}
                    />
                  )}
                  {filled > 0 && (
                    <span
                      className={`ml-1 font-mono text-[10px] font-medium tabular-nums ${
                        isActive ? 'text-current opacity-85' : 'text-[var(--color-ink-muted)]'
                      }`}
                    >
                      {filled}/{total}
                    </span>
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>
    )
  }

  const displayedPillars =
    filterMode === 'dogeared'
      ? pillars.filter((p) => p.topics.some((t) => isTopicDogeared(p.id, t.id)))
      : pillars

  return (
    <div
      className="guide-sidebar border-r border-[var(--color-line)] bg-[var(--color-surface-low)]"
      id="guide-pillar-nav"
    >
      <div className="mb-3 px-2.5 pt-1">
        <div className="mb-2 px-1 text-[11px] font-semibold tracking-wider text-[var(--color-ink-faint)] uppercase">
          Pillars
        </div>
        <SegmentedControl
          size="xs"
          fullWidth
          ariaLabel="Filter guide pages"
          value={filterMode}
          onChange={setFilterMode}
          items={[
            { value: 'all', label: 'All' },
            {
              value: 'dogeared',
              label: 'Dogeared',
              badge: dogearedTopicCount > 0 ? dogearedTopicCount : undefined,
            },
          ]}
        />
      </div>

      {filterMode === 'dogeared' && displayedPillars.length === 0 ? (
        <p className="px-3 py-4 text-[12.5px] leading-snug text-[var(--color-ink-faint)]">
          Fold the top-right corner of any page to bookmark it here.
        </p>
      ) : (
        displayedPillars.map((pillar) => {
          const isExpanded = filterMode === 'dogeared' || Boolean(expanded[pillar.id])
          const isPillarActive = pillarId === pillar.id
          const visibleTopics =
            filterMode === 'dogeared'
              ? pillar.topics.filter((t) => isTopicDogeared(pillar.id, t.id))
              : pillar.topics

          return (
            <div className="pillar-group" key={pillar.id}>
              <button
                type="button"
                className={`pillar-group-header${isPillarActive ? ' active' : ''}`}
                onClick={() => handlePillarClick(pillar)}
                id={`pillar-${pillar.id}`}
              >
                <span className="pillar-number border border-[var(--color-line-strong)] bg-[var(--color-surface-elevated)] font-mono text-[var(--color-ink-muted)] tabular-nums">
                  {pillar.number}
                </span>
                <span className="flex-1 text-left text-[var(--color-ink)]">
                  {pillar.shortName}
                </span>
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>

              {isExpanded && (
                <div className="pillar-group-items">
                  {visibleTopics.map((topic) => {
                    const isTopicActive = topicId === topic.id
                    const { filled, total } = getTopicProgress(pillar.id, topic.id)
                    const dogeared = isTopicDogeared(pillar.id, topic.id)

                    return (
                      <button
                        key={topic.id}
                        type="button"
                        className={`pillar-item flex items-center gap-1.5${
                          isTopicActive ? ' active' : ''
                        }`}
                        onClick={() => handleTopicClick(pillar, topic)}
                        id={`topic-${topic.id}`}
                      >
                        <span className="min-w-0 flex-1 truncate text-left">{topic.name}</span>
                        {dogeared && (
                          <Bookmark
                            size={11}
                            aria-label="Dogeared page"
                            className="shrink-0 fill-[var(--color-brand)] text-[var(--color-brand)]"
                          />
                        )}
                        {filled > 0 && (
                          <span className="shrink-0 rounded-full border border-[var(--color-line)] bg-[var(--color-surface-elevated)] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[var(--color-ink-muted)] tabular-nums">
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
        })
      )}
    </div>
  )
}
