import { useEffect, useCallback, useRef } from 'react'
import { GitCommit, Check, Loader2, X, Sparkles, AlertCircle } from 'lucide-react'
import { chatApi, type CommitSectionUpdate } from '../../utils/api'
import { KitAvatar, NoteUpdateCard } from '../ui'
import useAppStore from '../../stores/appStore'
import useCommitStore from '../../stores/useCommitStore'
import { useActiveKit } from '../../stores/useKitStore'

type DiffHunk = { type: 'ctx' | 'del' | 'add'; line: string }

function extractSummaryBullets(update: CommitSectionUpdate): string[] {
  const bullets: string[] = []
  if (update.reason?.trim()) {
    bullets.push(update.reason.trim())
  }
  const lines = update.newContent
    .split('\n')
    .map((raw) =>
      raw
        .replace(/^#{1,6}\s+/, '')
        .replace(/^[-*+]\s+/, '')
        .replace(/^\d+\.\s+/, '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .trim(),
    )
    .filter((l) => l.length >= 16 && !l.startsWith('```') && !l.startsWith('|'))

  for (const line of lines) {
    if (bullets.length >= 3) break
    if (!bullets.some((b) => b.toLowerCase() === line.toLowerCase())) {
      bullets.push(line.length > 140 ? `${line.slice(0, 137)}…` : line)
    }
  }
  return bullets
}

function buildLineDiff(existingRaw: string | undefined, nextRaw: string): DiffHunk[] {
  const oldLines = (existingRaw || '')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0)
  const newLines = nextRaw
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0)

  if (oldLines.length === 0) {
    return newLines.map((line) => ({ type: 'add', line }))
  }

  const m = oldLines.length
  const n = newLines.length

  // ponytail: exact LCS up to 250k cells (~500x500 lines); above that, anchor common prefix/suffix so 100% of lines still show without quadratic lag
  if (m * n > 250_000) {
    let prefixLen = 0
    while (
      prefixLen < m &&
      prefixLen < n &&
      oldLines[prefixLen].trim() === newLines[prefixLen].trim()
    ) {
      prefixLen++
    }
    let suffixLen = 0
    while (
      suffixLen < m - prefixLen &&
      suffixLen < n - prefixLen &&
      oldLines[m - 1 - suffixLen].trim() === newLines[n - 1 - suffixLen].trim()
    ) {
      suffixLen++
    }
    const fallback: DiffHunk[] = []
    for (let i = 0; i < prefixLen; i++) fallback.push({ type: 'ctx', line: newLines[i] })
    for (let i = prefixLen; i < m - suffixLen; i++) {
      fallback.push({ type: 'del', line: oldLines[i] })
    }
    for (let j = prefixLen; j < n - suffixLen; j++) {
      fallback.push({ type: 'add', line: newLines[j] })
    }
    for (let j = n - suffixLen; j < n; j++) fallback.push({ type: 'ctx', line: newLines[j] })
    return fallback
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        oldLines[i].trim() === newLines[j].trim()
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const hunks: DiffHunk[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (oldLines[i].trim() === newLines[j].trim()) {
      hunks.push({ type: 'ctx', line: newLines[j] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      hunks.push({ type: 'del', line: oldLines[i] })
      i++
    } else {
      hunks.push({ type: 'add', line: newLines[j] })
      j++
    }
  }
  while (i < m) hunks.push({ type: 'del', line: oldLines[i++] })
  while (j < n) hunks.push({ type: 'add', line: newLines[j++] })
  return hunks
}

/**
 * CommitModal — Clean Note Update review modal with progressive diff disclosure.
 *
 * Uses global useCommitStore so background processes can run
 * when minimized into the TaskWorkingBar.
 */
export default function CommitModal() {
  const selectedModel = useAppStore((s) => s.model)
  const addToast = useAppStore((s) => s.addToast)
  const { sectionsByPillar } = useActiveKit()

  const isOpen = useCommitStore((s) => s.isOpen)
  const phase = useCommitStore((s) => s.phase)
  const errorMsg = useCommitStore((s) => s.errorMsg)
  const updates = useCommitStore((s) => s.updates)
  const enabledSections = useCommitStore((s) => s.enabledSections)
  const savedCount = useCommitStore((s) => s.savedCount)
  const messages = useCommitStore((s) => s.messages)
  const topicContext = useCommitStore((s) => s.topicContext)
  const closeCompletely = useCommitStore((s) => s.closeCompletely)
  const setMinimized = useCommitStore((s) => s.setMinimized)
  const setPhase = useCommitStore((s) => s.setPhase)
  const setError = useCommitStore((s) => s.setError)
  const setUpdatesResult = useCommitStore((s) => s.setUpdatesResult)
  const mergeUpdatesResult = useCommitStore((s) => s.mergeUpdatesResult)
  const setEnabledSections = useCommitStore((s) => s.setEnabledSections)
  const setSavedCount = useCommitStore((s) => s.setSavedCount)

  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    }
  }, [])

  const analyze = useCallback(
    async (targetSectionIds: string[] = []) => {
      if (!topicContext) return
      const callId = Date.now()
      useCommitStore.setState({ currentCallId: callId })
      setPhase('analyzing')

      try {
        const payload: {
          messages: Array<{ role: string; content: string }>
          pillarId: string
          topicId: string
          topicName: string
          model: string
          targetSectionIds?: string[]
        } = {
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          pillarId: topicContext.pillarId,
          topicId: topicContext.topicId,
          topicName: topicContext.topicName,
          model: selectedModel,
        }
        if (targetSectionIds.length > 0) {
          payload.targetSectionIds = targetSectionIds
        }

        const result = (await chatApi.commitAnalyze(payload)) as {
          updates?: CommitSectionUpdate[]
        }

        if (callId !== useCommitStore.getState().currentCallId) return

        if (!result.updates || result.updates.length === 0) {
          if (targetSectionIds.length === 0) {
            setUpdatesResult([], new Set())
          } else {
            setError('Failed to generate content for the selected sections.')
          }
          return
        }

        if (targetSectionIds.length > 0) {
          mergeUpdatesResult(result.updates, targetSectionIds)
        } else {
          const initialEnabled = new Set(result.updates.map((u) => u.sectionId))
          setUpdatesResult(result.updates, initialEnabled)
        }
      } catch (err) {
        if (callId !== useCommitStore.getState().currentCallId) return
        setError(err instanceof Error ? err.message : 'Failed to analyze session.')
      }
    },
    [
      messages,
      topicContext,
      selectedModel,
      setPhase,
      setUpdatesResult,
      setError,
      mergeUpdatesResult,
    ],
  )

  const handleCloseOrMinimize = useCallback(() => {
    if (phase === 'analyzing' || phase === 'saving' || phase === 'preview') {
      setMinimized(true)
    } else {
      closeCompletely()
    }
  }, [phase, setMinimized, closeCompletely])

  useEffect(() => {
    if (isOpen && phase === 'idle' && topicContext?.pillarId) {
      const timer = setTimeout(() => {
        void analyze()
      }, 0)

      return () => {
        clearTimeout(timer)
      }
    }
  }, [isOpen, phase, topicContext?.pillarId, topicContext?.topicId, analyze])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase !== 'saving') {
        e.preventDefault()
        e.stopImmediatePropagation()
        handleCloseOrMinimize()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, phase, handleCloseOrMinimize])

  if (!isOpen) return null

  const toggleSection = (sectionId: string) => {
    setEnabledSections((prev) => {
      const next = new Set(prev)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })
  }

  const handleSave = async () => {
    if (!topicContext) return
    const toSave = updates.filter((u) => enabledSections.has(u.sectionId))
    if (toSave.length === 0) return

    setPhase('saving')
    try {
      const result = (await chatApi.commitSave({
        pillarId: topicContext.pillarId,
        topicId: topicContext.topicId,
        updates: toSave.map((u) => ({ sectionId: u.sectionId, content: u.newContent })),
      })) as { savedCount?: number }
      const count = result.savedCount || toSave.length
      setSavedCount(count)
      setPhase('done')
      addToast({
        type: 'success',
        message: `Committed ${count} section${toSave.length !== 1 ? 's' : ''} to "${topicContext.topicName}" guide`,
      })

      window.dispatchEvent(new Event('guide-progress-updated'))

      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
      closeTimerRef.current = setTimeout(closeCompletely, 1500)
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to save.',
      })
      setPhase('preview')
    }
  }

  const enabledCount = enabledSections.size
  const allSections = topicContext ? sectionsByPillar[topicContext.pillarId] || [] : []
  const updateMap = new Map(updates.map((u) => [u.sectionId, u]))
  const identifiedIds = new Set(updates.map((u) => u.sectionId))
  const requiresReanalysis = Array.from(enabledSections).some((id) => !identifiedIds.has(id))

  const headerKitState =
    phase === 'analyzing' || phase === 'saving'
      ? 'thinking'
      : phase === 'done'
        ? 'done'
        : 'idle'

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[3px] max-md:items-end max-md:p-0"
      onClick={(e) => {
        if (e.target === e.currentTarget && phase !== 'saving') handleCloseOrMinimize()
      }}
    >
      <div
        id="commit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="commit-modal-title"
        className="flex max-h-[90dvh] w-full max-w-[740px] flex-col overflow-hidden rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-surface-card)] shadow-[var(--shadow-float)] max-md:rounded-b-none max-md:border-b-0"
      >
        {/* ── Header ── */}
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-line)] px-4 py-3.5 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-3">
            <KitAvatar size={20} state={headerKitState} />
            <div className="min-w-0">
              <h2
                id="commit-modal-title"
                className="font-serif text-[17px] leading-tight font-normal text-[var(--color-ink)]"
              >
                Commit to Guide
              </h2>
              <div className="truncate text-[12px] text-[var(--color-ink-muted)]">
                {topicContext?.topicName || 'Unknown topic'}
              </div>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-ink)] sm:h-8 sm:w-8"
            onClick={handleCloseOrMinimize}
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Analyzing Phase ── */}
        {phase === 'analyzing' && (
          <div className="flex min-h-[260px] flex-1 items-center justify-center p-10">
            <div className="flex max-w-xs flex-col items-center text-center">
              <div className="mb-3.5">
                <KitAvatar size={28} state="thinking" />
              </div>
              <div className="font-serif text-[17px] text-[var(--color-ink)]">
                Analyzing Your Session
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
                Kit is reconciling your discussion against existing Guide sections.
              </p>
              <Loader2
                size={18}
                className="mt-4 animate-spin text-[var(--color-ink-faint)]"
              />
            </div>
          </div>
        )}

        {/* ── Error Phase ── */}
        {phase === 'error' && (
          <div className="flex min-h-[240px] flex-1 items-center justify-center p-8">
            <div className="max-w-sm text-center">
              <div className="mx-auto mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--color-err)]/30 bg-[var(--color-diff-del-bg)] text-[var(--color-err)]">
                <AlertCircle size={20} />
              </div>
              <div className="font-serif text-[17px] text-[var(--color-ink)]">
                Nothing to Commit
              </div>
              <div className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
                {errorMsg}
              </div>
              <button
                type="button"
                className="mt-4 inline-flex h-8 cursor-pointer items-center rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-surface-elevated)] px-3.5 text-[13px] font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-hover)]"
                onClick={closeCompletely}
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* ── Done Phase ── */}
        {phase === 'done' && (
          <div className="flex min-h-[240px] flex-1 items-center justify-center p-8">
            <div className="flex flex-col items-center text-center">
              <div className="mb-3">
                <KitAvatar size={28} state="done" />
              </div>
              <div className="font-serif text-[19px] text-[var(--color-ink)]">Committed!</div>
              <div className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
                {savedCount} section{savedCount !== 1 ? 's' : ''} saved to{' '}
                {topicContext?.topicName}
              </div>
            </div>
          </div>
        )}

        {/* ── Preview Phase ── */}
        {(phase === 'preview' || phase === 'saving') && (
          <>
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--color-line)] bg-[var(--color-surface-low)] px-4 py-2.5 text-[12px] text-[var(--color-ink-muted)] sm:px-6">
              <div className="tabular-nums">
                <strong className="font-semibold text-[var(--color-ink)]">
                  {updates.length}
                </strong>{' '}
                section{updates.length !== 1 ? 's' : ''} identified ·{' '}
                <strong className="font-semibold text-[var(--color-brand)]">
                  {enabledCount}
                </strong>{' '}
                enabled for commit
              </div>
              <button
                type="button"
                className="min-h-[36px] cursor-pointer rounded px-2 py-1 text-[11.5px] font-medium text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-ink)] sm:min-h-0"
                onClick={() => {
                  if (enabledCount === allSections.length) {
                    setEnabledSections(new Set())
                  } else {
                    setEnabledSections(new Set(allSections.map((s) => s.id)))
                  }
                }}
              >
                {enabledCount === allSections.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>

            {/* Section cards using shared NoteUpdateCard primitive */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
              {allSections.map((sec) => {
                const update = updateMap.get(sec.id)
                const isEnabled = enabledSections.has(sec.id)
                const isIdentified = Boolean(update)
                const bullets = update ? extractSummaryBullets(update) : []
                const hunks = update
                  ? buildLineDiff(update.existingContent, update.newContent)
                  : []

                return (
                  <NoteUpdateCard
                    key={sec.id}
                    sectionName={sec.name}
                    summaryBullets={isIdentified ? bullets : undefined}
                    hunks={isIdentified ? hunks : []}
                    className={`transition-opacity ${isEnabled ? 'opacity-100' : 'opacity-60'}`}
                    headerLeft={
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={isEnabled}
                        aria-label={`Include ${sec.name}`}
                        onClick={() => toggleSection(sec.id)}
                        className={`flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded border transition-colors sm:h-5 sm:w-5 ${
                          isEnabled
                            ? 'border-[var(--color-accent-fill)] bg-[var(--color-accent-fill)] text-[var(--color-accent-ink)]'
                            : 'border-[var(--color-line-strong)] bg-[var(--color-surface-low)]'
                        }`}
                      >
                        {isEnabled && <Check size={12} strokeWidth={2.5} />}
                      </button>
                    }
                    badge={
                      update ? (
                        <span
                          className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase ${
                            update.isNew
                              ? 'bg-[var(--color-diff-add-bg)] text-[var(--color-diff-add-ink)]'
                              : 'border border-[var(--color-line-strong)] bg-[var(--color-surface-elevated)] text-[var(--color-ink-muted)]'
                          }`}
                        >
                          {update.isNew ? 'NEW' : 'MERGE'}
                        </span>
                      ) : (
                        <span className="rounded border border-[var(--color-line)] bg-[var(--color-surface-low)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-ink-faint)] uppercase">
                          MISSING
                        </span>
                      )
                    }
                  >
                    {!isIdentified && (
                      <p className="mt-1 text-[12px] text-[var(--color-ink-faint)]">
                        Select to force analysis of this section.
                      </p>
                    )}
                  </NoteUpdateCard>
                )
              })}
            </div>

            {/* Footer */}
            <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-[var(--color-line)] bg-[var(--color-surface-low)] px-4 pt-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom,0px))] sm:px-6 sm:pb-3.5">
              <button
                type="button"
                className="inline-flex h-11 cursor-pointer items-center rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-surface-elevated)] px-3.5 text-[13px] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-45 sm:h-9"
                onClick={closeCompletely}
                disabled={phase === 'saving'}
              >
                Cancel
              </button>
              {requiresReanalysis ? (
                <button
                  type="button"
                  className="inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-lg bg-[var(--color-accent-fill)] px-4 text-[13px] font-semibold text-[var(--color-accent-ink)] transition-colors hover:bg-[var(--color-accent-fill-hover)] disabled:opacity-45 sm:h-9"
                  onClick={() => {
                    void analyze(Array.from(enabledSections))
                  }}
                  disabled={phase === 'saving' || enabledCount === 0}
                  id="confirm-commit-btn"
                >
                  <Sparkles size={14} /> Re-Analyze Selected
                </button>
              ) : (
                <button
                  type="button"
                  className="inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-lg bg-[var(--color-accent-fill)] px-4 text-[13px] font-semibold text-[var(--color-accent-ink)] transition-colors hover:bg-[var(--color-accent-fill-hover)] disabled:opacity-45 sm:h-9"
                  onClick={() => {
                    void handleSave()
                  }}
                  disabled={phase === 'saving' || enabledCount === 0}
                  id="confirm-commit-btn"
                >
                  {phase === 'saving' ? (
                    <>
                      <Loader2 size={14} className="animate-spin" /> Saving…
                    </>
                  ) : (
                    <>
                      <GitCommit size={14} /> Commit {enabledCount} Section
                      {enabledCount !== 1 ? 's' : ''}
                    </>
                  )}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
