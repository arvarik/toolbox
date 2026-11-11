import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ArrowUpRight, GitCommit, MessageSquare, X } from 'lucide-react'
import type { Pillar } from '../../shared/kits/kitSkeleton'
import LearningChat, { type ActiveStudyTopic } from '../components/chat/LearningChat'
import LearningTodo from '../components/chat/LearningTodo'
import type { ChatMessage, ChatSession } from '../components/chat/SessionPicker'
import MarkdownRenderer from '../components/shared/MarkdownRenderer'
import { Button, NotebookSheet, SegmentedControl } from '../components/ui'
import useIsMobile from '../hooks/useIsMobile'
import useCommitStore from '../stores/useCommitStore'
import { useActiveKit, useKitRoutePrefix } from '../stores/useKitStore'
import { guideContentApi } from '../utils/api'

interface BottomSheetDrawerProps {
  open: boolean
  onClose: () => void
  children: ReactNode
}

/**
 * Bottom-sheet drawer for mobile — slides up from the bottom edge.
 * Exposes the curriculum spine on small screens.
 */
function BottomSheetDrawer({ open, onClose, children }: BottomSheetDrawerProps) {
  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-[400] bg-black/55 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Curriculum spine"
        className="fixed right-0 bottom-0 left-0 z-[401] flex h-[75vh] flex-col overflow-hidden rounded-t-2xl border border-b-0 border-[var(--color-line-strong)] bg-[var(--color-surface)] shadow-[var(--shadow-float)]"
      >
        <div className="relative flex shrink-0 items-center justify-between px-4 pt-3 pb-2">
          <div className="mx-auto h-1 w-10 rounded-full bg-[var(--color-line-strong)]" />
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm absolute top-2.5 right-3"
            onClick={onClose}
            aria-label="Close curriculum drawer"
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </>
  )
}

type InspectorTab = 'guide' | 'updates'

/**
 * ChatPage — 3-Pane Codex Study Workspace (Curriculum Spine · Kit Stage · Notebook Inspector).
 */
export default function ChatPage() {
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const prefix = useKitRoutePrefix()
  const { kitSlug, pillars, sectionsByPillar } = useActiveKit()
  const routeKitSlug = prefix ? decodeURIComponent(prefix.slice(3)) : null
  const queryPillarId = searchParams.get('pillar')
  const queryTopicId = searchParams.get('topic')

  const [todoDrawerOpen, setTodoDrawerOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1200 : false,
  )
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('guide')

  const startAnalysis = useCommitStore((s) => s.startAnalysis)
  const [activeStudyTopic, setActiveStudyTopic] = useState<ActiveStudyTopic | null>(null)
  const [sessionState, setSessionState] = useState<{
    session: ChatSession | null
    messages: ChatMessage[]
  }>({ session: null, messages: [] })

  const [topicNotes, setTopicNotes] = useState<
    Record<string, { content: string; committedAt?: string | null }>
  >({})

  // Reset dangling topic selection & drawer when switching Kits on /k/:slug/chat
  useEffect(() => {
    setActiveStudyTopic(null)
    setTodoDrawerOpen(false)
    setTopicNotes({})
  }, [prefix, kitSlug])

  // Deep-link topic initialization from Guide's "Study in Chat" (?pillar=&topic=)
  useEffect(() => {
    if (!queryPillarId || !queryTopicId) return
    const p = pillars.find((item) => item.id === queryPillarId)
    const t = p?.topics.find((item) => item.id === queryTopicId)
    if (p && t) {
      setActiveStudyTopic({ pillar: p, topic: t })
    }
  }, [queryPillarId, queryTopicId, pillars])

  useEffect(() => {
    const handler = () => setTodoDrawerOpen(true)
    window.addEventListener('toggle-study-plan', handler)
    return () => window.removeEventListener('toggle-study-plan', handler)
  }, [])

  const handleStudyTopic = useCallback(
    (pillar: Pillar, topic: Pillar['topics'][number]) => {
      setTodoDrawerOpen(false)
      requestAnimationFrame(() => setActiveStudyTopic({ pillar, topic }))
    },
    [],
  )

  const resolvedTopic = useMemo<ActiveStudyTopic | null>(() => {
    if (activeStudyTopic) return activeStudyTopic
    const pId = sessionState.session?.pillarId
    const tId = sessionState.session?.topicId
    if (!pId || !tId) return null
    const p = pillars.find((item) => item.id === pId)
    const t = p?.topics.find((item) => item.id === tId)
    return p && t ? { pillar: p, topic: t } : null
  }, [
    activeStudyTopic,
    sessionState.session?.pillarId,
    sessionState.session?.topicId,
    pillars,
  ])

  const loadTopicNotes = useCallback(() => {
    if (!resolvedTopic) {
      setTopicNotes({})
      return
    }
    Promise.resolve(
      guideContentApi?.getForTopic?.(resolvedTopic.pillar.id, resolvedTopic.topic.id),
    )
      .then((res) => setTopicNotes(res || {}))
      .catch(() => setTopicNotes({}))
  }, [resolvedTopic])

  useEffect(() => {
    if (isMobile || !inspectorOpen) return
    loadTopicNotes()
    window.addEventListener('guide-progress-updated', loadTopicNotes)
    return () => window.removeEventListener('guide-progress-updated', loadTopicNotes)
  }, [isMobile, inspectorOpen, loadTopicNotes])

  const handleAskKitAboutSection = (sectionName: string, content?: string, hint?: string) => {
    const cleanExcerpt = content?.replace(/\s+/g, ' ').trim().slice(0, 200)
    const topicTitle = resolvedTopic?.topic.name ?? 'Topic'
    const quote = cleanExcerpt
      ? `${topicTitle} (${sectionName}): ${cleanExcerpt}${content && content.length > 200 ? '…' : ''}`
      : `${topicTitle} — ${sectionName}${hint ? `: ${hint}` : ''}`
    try {
      localStorage.setItem('toolbox_chat_quote', quote)
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent('toolbox:ask-kit', { detail: { quote } }))
  }

  const activeSections = resolvedTopic
    ? sectionsByPillar[resolvedTopic.pillar.id] || []
    : []
  const committedSections = activeSections.filter((s) =>
    Boolean(topicNotes[s.id]?.content?.trim()),
  )
  const aiMessageCount = sessionState.messages.filter(
    (m) => m.role === 'ai' && m.content.trim().length > 0,
  ).length

  return (
    <div className="learning-hub-layout" id="chat-page">
      {!isMobile && (
        <LearningTodo
          onStudyTopic={handleStudyTopic}
          activeTopicId={resolvedTopic?.topic.id ?? null}
        />
      )}

      <div className="learning-hub-main min-w-0 flex-1">
        <LearningChat
          activeTopic={activeStudyTopic}
          onClearTopicOverride={() => setActiveStudyTopic(null)}
          onCommitClick={startAnalysis}
          routeKitSlug={routeKitSlug}
          notebookOpen={!isMobile ? inspectorOpen : undefined}
          onToggleNotebook={!isMobile ? () => setInspectorOpen((o) => !o) : undefined}
          onSessionStateChange={setSessionState}
        />
      </div>

      {!isMobile && inspectorOpen && (
        <aside
          data-testid="chat-notebook-inspector"
          className="flex w-[340px] shrink-0 flex-col overflow-hidden border-l border-[var(--color-line)] bg-[var(--color-surface-low)] xl:w-[380px]"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--color-line)] px-3.5 py-2.5">
            <SegmentedControl
              size="xs"
              ariaLabel="Notebook inspector tabs"
              value={inspectorTab}
              onChange={setInspectorTab}
              items={[
                { value: 'guide', label: 'Guide' },
                {
                  value: 'updates',
                  label: 'Updates',
                  badge: committedSections.length > 0 ? committedSections.length : undefined,
                },
              ]}
            />
            <button
              type="button"
              onClick={() => setInspectorOpen(false)}
              aria-label="Close notebook inspector"
              className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-ink)]"
            >
              <X size={14} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
            {inspectorTab === 'guide' ? (
              resolvedTopic ? (
                <NotebookSheet className="p-4">
                  <div className="mb-3 flex items-start justify-between gap-2 border-b border-[var(--color-line)] pb-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-medium text-[var(--color-ink-faint)]">
                        {resolvedTopic.pillar.shortName}
                      </div>
                      <h3 className="truncate font-serif text-[16px] font-normal text-[var(--color-ink)]">
                        {resolvedTopic.topic.name}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        navigate(
                          `${prefix}/guide/${resolvedTopic.pillar.id}/${resolvedTopic.topic.id}`,
                        )
                      }
                      className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-[var(--color-line-strong)] bg-[var(--color-surface-elevated)] px-2 py-1 text-[11.5px] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-hover)]"
                    >
                      Open Guide
                      <ArrowUpRight size={12} />
                    </button>
                  </div>

                  <div className="divide-y divide-[var(--color-line)]">
                    {activeSections.map((sec) => {
                      const entry = topicNotes[sec.id]
                      const hasNotes = Boolean(entry?.content?.trim())
                      return (
                        <div key={sec.id} className="py-3 first:pt-0 last:pb-0">
                          <div className="mb-1.5 flex items-center justify-between gap-2">
                            <h4 className="truncate font-serif text-[13.5px] font-medium text-[var(--color-ink)]">
                              {sec.name}
                            </h4>
                            <button
                              type="button"
                              onClick={() =>
                                handleAskKitAboutSection(
                                  sec.name,
                                  entry?.content,
                                  sec.promptHint,
                                )
                              }
                              className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] font-medium text-[var(--color-brand)] transition-colors hover:bg-[var(--color-surface-hover)]"
                            >
                              <MessageSquare size={11} />
                              Ask Kit
                            </button>
                          </div>

                          {hasNotes && entry ? (
                            <div className="max-h-44 overflow-y-auto text-[12.5px] leading-relaxed text-[var(--color-ink-muted)]">
                              <MarkdownRenderer content={entry.content} />
                            </div>
                          ) : (
                            <p className="text-[12px] text-[var(--color-ink-faint)]">
                              No notes yet.
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </NotebookSheet>
              ) : (
                <NotebookSheet className="p-4">
                  <h3 className="font-serif text-[16px] text-[var(--color-ink)]">
                    Guide Companion
                  </h3>
                  <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
                    Pick a topic on the left to preview its Guide notes here.
                  </p>
                  <div className="mt-3">
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={() => navigate(`${prefix}/guide`)}
                    >
                      Browse full Guide <ArrowUpRight size={12} />
                    </Button>
                  </div>
                </NotebookSheet>
              )
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface-card)] p-4">
                  <h3 className="font-serif text-[15.5px] text-[var(--color-ink)]">
                    Synthesize Guide Notes
                  </h3>
                  <p className="mt-1 text-[12.5px] leading-snug text-[var(--color-ink-muted)]">
                    Turn insights from this session into structured Guide sections.
                  </p>

                  <div className="mt-3">
                    <Button
                      variant="primary"
                      size="sm"
                      className="w-full"
                      disabled={
                        !resolvedTopic ||
                        aiMessageCount === 0 ||
                        !sessionState.session ||
                        Boolean(
                          sessionState.session.topicId &&
                            (sessionState.session.pillarId !== resolvedTopic.pillar.id ||
                              sessionState.session.topicId !== resolvedTopic.topic.id),
                        )
                      }
                      onClick={() => {
                        if (!resolvedTopic || !sessionState.session) return
                        if (
                          sessionState.session.topicId &&
                          (sessionState.session.pillarId !== resolvedTopic.pillar.id ||
                            sessionState.session.topicId !== resolvedTopic.topic.id)
                        ) {
                          return
                        }
                        startAnalysis(sessionState.messages, {
                          pillarId: resolvedTopic.pillar.id,
                          topicId: resolvedTopic.topic.id,
                          topicName: resolvedTopic.topic.name,
                        })
                      }}
                    >
                      <GitCommit size={13} />
                      Commit Session to Guide
                    </Button>
                    {(!resolvedTopic || aiMessageCount === 0) && (
                      <p className="mt-2 text-[11.5px] text-[var(--color-ink-faint)]">
                        {!resolvedTopic
                          ? 'Select a topic on the left to enable commits.'
                          : 'Exchange at least one reply with Kit first.'}
                      </p>
                    )}
                  </div>
                </div>

                {resolvedTopic && (
                  <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-card)] p-3.5">
                    <div className="mb-2 text-[11px] font-semibold tracking-wider text-[var(--color-ink-faint)] uppercase">
                      Committed in {resolvedTopic.topic.name}
                    </div>
                    {committedSections.length === 0 ? (
                      <p className="text-[12.5px] text-[var(--color-ink-muted)]">
                        No sections committed for this topic yet.
                      </p>
                    ) : (
                      <ul className="divide-y divide-[var(--color-line)]">
                        {committedSections.map((sec) => {
                          const ts = topicNotes[sec.id]?.committedAt
                          return (
                            <li
                              key={sec.id}
                              className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  navigate(
                                    `${prefix}/guide/${resolvedTopic.pillar.id}/${resolvedTopic.topic.id}`,
                                  )
                                }
                                className="min-w-0 cursor-pointer truncate text-left font-serif text-[13px] text-[var(--color-ink)] hover:text-[var(--color-brand)]"
                              >
                                {sec.name}
                              </button>
                              {ts && (
                                <span className="shrink-0 font-mono text-[10.5px] text-[var(--color-ink-faint)] tabular-nums">
                                  {new Date(ts).toLocaleDateString()}
                                </span>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      )}

      {isMobile && (
        <BottomSheetDrawer open={todoDrawerOpen} onClose={() => setTodoDrawerOpen(false)}>
          <LearningTodo
            onStudyTopic={handleStudyTopic}
            activeTopicId={resolvedTopic?.topic.id ?? null}
          />
        </BottomSheetDrawer>
      )}
    </div>
  )
}
