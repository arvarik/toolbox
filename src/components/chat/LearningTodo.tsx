import { useState, useEffect, useCallback } from 'react'
import {
  ArrowUpRight,
  Bookmark,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
} from 'lucide-react'
import { useNavigate } from 'react-router'
import type { Pillar } from '../../../shared/kits/kitSkeleton'
import {
  guideContentApi,
  type GuideDogearItem,
  type GuideResumeRef,
} from '../../utils/api'
import { useActiveKit, useKitRoutePrefix } from '../../stores/useKitStore'
import Skeleton from '../shared/Skeleton'

type PillarTopic = Pillar['topics'][number]

interface LearningTodoProps {
  onStudyTopic?: (pillar: Pillar, topic: PillarTopic) => void
  activeTopicId?: string | null
}

/**
 * LearningTodo — warm monochrome curriculum spine showing Guide progress,
 * dogeared topics, and 1-click reading resume.
 */
export default function LearningTodo({ onStudyTopic, activeTopicId }: LearningTodoProps) {
  const [progress, setProgress] = useState<Record<string, boolean>>({})
  const [dogears, setDogears] = useState<GuideDogearItem[]>([])
  const [fetchedResume, setFetchedResume] = useState<GuideResumeRef | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [expandedPillars, setExpandedPillars] = useState<Record<string, boolean>>({})
  const navigate = useNavigate()
  const { kit: activeKit, pillars, sectionsByPillar, kitSlug } = useActiveKit()
  const prefix = useKitRoutePrefix()

  const kitResumeRef =
    (activeKit as { lastGuideRef?: GuideResumeRef | null } | null)?.lastGuideRef ?? null
  const lastGuideRef = fetchedResume ?? kitResumeRef

  const fetchSpineMeta = useCallback(() => {
    Promise.resolve(guideContentApi?.progress?.())
      .then((data) => setProgress((data as Record<string, boolean> | null) || {}))
      .catch(() => setProgress({}))
      .finally(() => setIsLoading(false))

    Promise.resolve(guideContentApi?.listDogears?.())
      .then((items) => setDogears(Array.isArray(items) ? items : []))
      .catch(() => setDogears([]))

    Promise.resolve(guideContentApi?.getResume?.())
      .then((res) => setFetchedResume(res?.resume ?? null))
      .catch(() => {})
  }, [])

  useEffect(() => {
    setIsLoading(true)
    setFetchedResume(null)
    fetchSpineMeta()
    window.addEventListener('guide-progress-updated', fetchSpineMeta)
    window.addEventListener('guide-dogears-updated', fetchSpineMeta)
    return () => {
      window.removeEventListener('guide-progress-updated', fetchSpineMeta)
      window.removeEventListener('guide-dogears-updated', fetchSpineMeta)
    }
  }, [kitSlug, prefix, fetchSpineMeta])

  const togglePillar = (pillarId: string) => {
    setExpandedPillars((prev) => ({ ...prev, [pillarId]: !prev[pillarId] }))
  }

  // Compute totals strictly across active Kit pillars/topics/sections
  const totalSections = pillars.reduce((acc, p) => {
    const sections = sectionsByPillar[p.id] || []
    return acc + p.topics.length * sections.length
  }, 0)

  const filledSections = pillars.reduce((acc, p) => {
    const sections = sectionsByPillar[p.id] || []
    return (
      acc +
      p.topics.reduce(
        (topicAcc, t) =>
          topicAcc + sections.filter((s) => progress[`${p.id}__${t.id}__${s.id}`]).length,
        0,
      )
    )
  }, 0)

  const overallPercent =
    totalSections > 0 ? Math.round((filledSections / totalSections) * 100) : 0

  // Find the first incomplete topic to highlight as "Start Here"
  let suggestedTopic: PillarTopic | null = null
  let suggestedPillar: Pillar | null = null
  outer: for (const pillar of pillars) {
    const sections = sectionsByPillar[pillar.id] || []
    for (const topic of pillar.topics) {
      const filledCount = sections.filter(
        (s) => progress[`${pillar.id}__${topic.id}__${s.id}`],
      ).length
      if (filledCount < sections.length) {
        suggestedTopic = topic
        suggestedPillar = pillar
        break outer
      }
    }
  }

  const resumeTopicName = (() => {
    if (!lastGuideRef?.pillarId || !lastGuideRef?.topicId) return null
    const p = pillars.find((item) => item.id === lastGuideRef.pillarId)
    return p?.topics.find((t) => t.id === lastGuideRef.topicId)?.name ?? null
  })()

  const isTopicDogeared = (pId: string, tId: string) =>
    dogears.some((d) => d.pillarId === pId && d.topicId === tId)

  return (
    <aside
      className="learning-todo flex flex-col overflow-hidden border-r border-[var(--color-line)] bg-[var(--color-surface-low)]"
      id="learning-todo"
    >
      {/* Header */}
      <div className="learning-todo-header border-b border-[var(--color-line)] px-3.5 py-3.5">
        {lastGuideRef?.pillarId && lastGuideRef?.topicId && (
          <button
            type="button"
            data-testid="resume-reading-pill"
            onClick={() =>
              navigate(`${prefix}/guide/${lastGuideRef.pillarId}/${lastGuideRef.topicId}`)
            }
            className="mb-3 flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-surface-elevated)] px-2.5 py-1.5 text-left text-[12px] text-[var(--color-ink)] shadow-[var(--shadow-hairline)] transition-colors hover:bg-[var(--color-surface-hover)] active:scale-[0.98]"
          >
            <span className="min-w-0 truncate">
              <span className="font-medium text-[var(--color-brand)]">Resume reading</span>
              {resumeTopicName && (
                <span className="text-[var(--color-ink-muted)]"> · {resumeTopicName}</span>
              )}
            </span>
            <ArrowUpRight size={13} className="shrink-0 text-[var(--color-ink-faint)]" />
          </button>
        )}

        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <BookOpen size={14} className="text-[var(--color-ink-muted)]" />
            <span className="text-[12.5px] font-semibold text-[var(--color-ink)]">
              Guide Progress
            </span>
          </div>
          <span className="font-mono text-[11px] font-medium text-[var(--color-ink-muted)] tabular-nums">
            {overallPercent}%
          </span>
        </div>

        {/* Overall progress bar */}
        <div className="mb-3">
          <div className="mb-1.5 flex justify-between text-[11px] text-[var(--color-ink-faint)] tabular-nums">
            <span>
              {filledSections} of {totalSections} sections filled
            </span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-[var(--color-surface-elevated)]">
            <div
              style={{ width: `${overallPercent}%` }}
              className="h-full rounded-full bg-[var(--color-ink-muted)] transition-[width] duration-300"
            />
          </div>
        </div>

        {/* Next topic suggestion */}
        {suggestedTopic && suggestedPillar && (
          <button
            type="button"
            onClick={() => onStudyTopic?.(suggestedPillar, suggestedTopic)}
            className="w-full cursor-pointer rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-surface-card)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-surface-hover)] active:scale-[0.99]"
          >
            <div className="mb-0.5 text-[10px] font-semibold tracking-wider text-[var(--color-ink-faint)] uppercase">
              Start Here
            </div>
            <div className="truncate text-[12.5px] font-medium text-[var(--color-ink)]">
              {suggestedTopic.name}
            </div>
            <div className="truncate text-[11px] text-[var(--color-ink-muted)]">
              {suggestedPillar.name}
            </div>
          </button>
        )}
      </div>

      {/* Pillar list */}
      <div className="learning-todo-list flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex flex-col gap-2 p-3.5">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} style={{ height: 34 }} />
            ))}
          </div>
        ) : (
          pillars.map((pillar) => {
            const sections = sectionsByPillar[pillar.id] || []
            const isExpanded = expandedPillars[pillar.id]

            const pillarFilled = pillar.topics.reduce((acc, topic) => {
              return (
                acc +
                sections.filter((s) => progress[`${pillar.id}__${topic.id}__${s.id}`]).length
              )
            }, 0)
            const pillarTotal = pillar.topics.length * sections.length
            const pillarPercent =
              pillarTotal > 0 ? Math.round((pillarFilled / pillarTotal) * 100) : 0

            return (
              <div
                key={pillar.id}
                className="todo-pillar-group border-b border-[var(--color-line)] last:border-b-0"
              >
                <button
                  type="button"
                  className="todo-pillar-header flex min-h-[44px] w-full cursor-pointer items-center gap-2 px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--color-surface-hover)] sm:min-h-0"
                  onClick={() => togglePillar(pillar.id)}
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-[var(--color-line-strong)] bg-[var(--color-surface-elevated)] font-mono text-[10.5px] font-medium text-[var(--color-ink-muted)] tabular-nums">
                    {pillar.number}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[var(--color-ink)]">
                    {pillar.shortName}
                  </span>
                  <span className="font-mono text-[10.5px] text-[var(--color-ink-faint)] tabular-nums">
                    {pillarPercent}%
                  </span>
                  {isExpanded ? (
                    <ChevronDown size={13} className="shrink-0 text-[var(--color-ink-faint)]" />
                  ) : (
                    <ChevronRight size={13} className="shrink-0 text-[var(--color-ink-faint)]" />
                  )}
                </button>

                {isExpanded && (
                  <div className="todo-topics border-t border-[var(--color-line)] bg-[var(--color-surface)]/40 py-1">
                    {pillar.topics.map((topic) => {
                      const filledCount = sections.filter(
                        (s) => progress[`${pillar.id}__${topic.id}__${s.id}`],
                      ).length
                      const topicComplete =
                        filledCount === sections.length && sections.length > 0
                      const hasAny = filledCount > 0
                      const dogeared = isTopicDogeared(pillar.id, topic.id)
                      const isActive = activeTopicId === topic.id

                      return (
                        <div key={topic.id} className="todo-topic-item">
                          <div
                            className={`todo-topic-row flex cursor-pointer items-center gap-2 px-3.5 py-1.5 transition-colors hover:bg-[var(--color-surface-hover)] ${
                              isActive ? 'bg-[var(--color-surface-elevated)]' : ''
                            }`}
                            onClick={() => onStudyTopic?.(pillar, topic)}
                          >
                            <div className="shrink-0">
                              {topicComplete ? (
                                <CheckCircle2
                                  size={13}
                                  className="text-[var(--color-ink-muted)]"
                                />
                              ) : hasAny ? (
                                <Circle
                                  size={13}
                                  strokeWidth={2.4}
                                  className="text-[var(--color-brand)]"
                                />
                              ) : (
                                <Circle
                                  size={13}
                                  className="text-[var(--color-ink-faint)]"
                                />
                              )}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`truncate text-[12px] font-medium ${
                                    topicComplete
                                      ? 'text-[var(--color-ink-muted)]'
                                      : 'text-[var(--color-ink)]'
                                  }`}
                                >
                                  {topic.name}
                                </span>
                                {dogeared && (
                                  <Bookmark
                                    size={11}
                                    aria-label="Dogeared topic"
                                    className="shrink-0 fill-[var(--color-brand)] text-[var(--color-brand)]"
                                  />
                                )}
                              </div>
                              <div className="font-mono text-[10px] text-[var(--color-ink-faint)] tabular-nums">
                                {filledCount}/{sections.length} sections
                              </div>
                            </div>

                            <button
                              type="button"
                              className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-surface-elevated)] hover:text-[var(--color-ink)]"
                              onClick={(e) => {
                                e.stopPropagation()
                                navigate(`${prefix}/guide/${pillar.id}/${topic.id}`)
                              }}
                              title="View in Guide"
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
    </aside>
  )
}
