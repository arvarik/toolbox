import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router'
import {
  Calculator,
  Archive,
  ChevronDown,
  ChevronRight,
  Copy,
  FolderInput,
  Trash2,
} from 'lucide-react'
import PillarNav from '../components/guide/PillarNav'
import BlueprintShell from '../components/guide/BlueprintShell'
import ChatPanel from '../components/shared/ChatPanel'
import { KitAvatar } from '../components/ui'
import useAppStore from '../stores/appStore'
import { useActiveKit } from '../stores/useKitStore'
import useIsMobile from '../hooks/useIsMobile'
import * as apiModule from '../utils/api'
import type { GuideDogearItem } from '../utils/api'

interface ArchivedNote {
  pillarId: string
  topicId: string
  sectionId: string
  content: string
}

interface KitsArchiveApi {
  getArchivedNotes?: (kitId: string) => Promise<{ notes?: ArchivedNote[] } | null>
  refileArchivedNote?: (
    kitId: string,
    payload: {
      fromPillarId: string
      fromTopicId: string
      fromSectionId: string
      toPillarId: string
      toTopicId: string
      toSectionId: string
    },
  ) => Promise<unknown>
  deleteArchivedNote?: (
    kitId: string,
    payload: { pillarId: string; topicId: string; sectionId: string },
  ) => Promise<unknown>
}

interface OptionalGuideNotebookApi {
  listDogears?: () => Promise<GuideDogearItem[]>
  toggleDogear?: (
    pillarId: string,
    topicId: string,
    sectionId?: string,
  ) => Promise<{ dogeared: boolean; createdAt: string | null }>
  putResume?: (
    pillarId: string,
    topicId: string,
    sectionId?: string,
  ) => Promise<unknown>
}

function safeGetKitsApi(): KitsArchiveApi | null {
  try {
    const mod = apiModule as unknown as { kitsApi?: KitsArchiveApi }
    return 'kitsApi' in mod ? (mod.kitsApi ?? null) : null
  } catch {
    return null
  }
}

function safeGetGuideNotebookApi(): OptionalGuideNotebookApi | null {
  try {
    const mod = apiModule as unknown as { guideContentApi?: OptionalGuideNotebookApi }
    return 'guideContentApi' in mod ? (mod.guideContentApi ?? null) : null
  } catch {
    return null
  }
}

/**
 * GuidePage — Living textbook notebook with automatic reading resume,
 * folded page dogears, and companion Kit drawer.
 */
export default function GuidePage() {
  const { pillarId, topicId } = useParams()
  const chatOpen = useAppStore((s) => s.chatOpen.guide)
  const toggleChat = useAppStore((s) => s.toggleChat)
  const setCalcModalOpen = useAppStore((s) => s.setCalcModalOpen)
  const addToast = useAppStore((s) => s.addToast)
  const { kitId, kitSlug, skeleton, pillars, capabilities } = useActiveKit()

  const isMobile = useIsMobile()

  const [dogears, setDogears] = useState<GuideDogearItem[]>([])
  const [archivedNotes, setArchivedNotes] = useState<ArchivedNote[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [refilingKey, setRefilingKey] = useState<string | null>(null)
  const [targetPillarId, setTargetPillarId] = useState('')
  const [targetTopicId, setTargetTopicId] = useState('')
  const [targetSectionId, setTargetSectionId] = useState('')

  // Automatic reading resume when viewing a specific topic page
  useEffect(() => {
    if (!pillarId || !topicId) return
    const guideApi = safeGetGuideNotebookApi()
    void Promise.resolve(guideApi?.putResume?.(pillarId, topicId)).catch(() => null)
  }, [pillarId, topicId, kitId, kitSlug])

  // Load folded page dogears for active Kit
  const loadDogears = useCallback(() => {
    const guideApi = safeGetGuideNotebookApi()
    if (!guideApi?.listDogears) {
      setDogears([])
      return
    }
    Promise.resolve(guideApi.listDogears())
      .then((items) => setDogears(Array.isArray(items) ? items : []))
      .catch(() => setDogears([]))
  }, [])

  useEffect(() => {
    loadDogears()
  }, [kitId, kitSlug, loadDogears])

  const handleToggleDogear = useCallback(
    (pId: string, tId: string, secId = '') => {
      let previous: GuideDogearItem[] = []
      setDogears((prev) => {
        previous = prev
        const exists = prev.some(
          (d) =>
            d.pillarId === pId &&
            d.topicId === tId &&
            (d.sectionId || '') === secId,
        )
        return exists
          ? prev.filter(
              (d) =>
                !(
                  d.pillarId === pId &&
                  d.topicId === tId &&
                  (d.sectionId || '') === secId
                ),
            )
          : [
              ...prev,
              {
                pillarId: pId,
                topicId: tId,
                sectionId: secId,
                createdAt: new Date().toISOString(),
              },
            ]
      })

      const guideApi = safeGetGuideNotebookApi()
      Promise.resolve(guideApi?.toggleDogear?.(pId, tId, secId))
        .then(() => {
          window.dispatchEvent(new Event('guide-dogears-updated'))
        })
        .catch(() => {
          setDogears(previous)
        })
    },
    [],
  )

  const openGuideChat = useCallback(() => {
    const state = useAppStore.getState() as unknown as {
      chatOpen?: Record<string, boolean>
      toggleChat?: (page: string) => void
      setChatOpen?: (page: string, open: boolean) => void
    }
    if (typeof state.setChatOpen === 'function') {
      state.setChatOpen('guide', true)
    } else if (!state.chatOpen?.guide && typeof state.toggleChat === 'function') {
      state.toggleChat('guide')
    }
  }, [])

  const loadArchived = useCallback(async () => {
    const kitsApi = safeGetKitsApi()
    if (!kitId || !kitsApi?.getArchivedNotes) {
      setArchivedNotes([])
      return
    }
    try {
      const res = await kitsApi.getArchivedNotes(kitId)
      setArchivedNotes(Array.isArray(res?.notes) ? res.notes : [])
    } catch {
      setArchivedNotes([])
    }
  }, [kitId])

  useEffect(() => {
    setRefilingKey(null)
    setDrawerOpen(false)
    void loadArchived()
  }, [kitId, loadArchived])

  const openRefilePicker = (key: string) => {
    if (refilingKey === key) {
      setRefilingKey(null)
      return
    }
    const p0 = pillars[0]
    const t0 = p0?.topics?.[0]
    const s0 = p0?.sections?.[0]
    setTargetPillarId(p0?.id || '')
    setTargetTopicId(t0?.id || '')
    setTargetSectionId(s0?.id || '')
    setRefilingKey(key)
  }

  const handlePillarTargetChange = (nextPid: string) => {
    const p = pillars.find((item) => item.id === nextPid)
    setTargetPillarId(nextPid)
    setTargetTopicId(p?.topics?.[0]?.id || '')
    setTargetSectionId(p?.sections?.[0]?.id || '')
  }

  const handleRefileNote = async (note: ArchivedNote) => {
    const kitsApi = safeGetKitsApi()
    if (!kitId || !kitsApi?.refileArchivedNote) return
    try {
      await kitsApi.refileArchivedNote(kitId, {
        fromPillarId: note.pillarId,
        fromTopicId: note.topicId,
        fromSectionId: note.sectionId,
        toPillarId: targetPillarId,
        toTopicId: targetTopicId,
        toSectionId: targetSectionId,
      })
      addToast({ type: 'success', message: 'Archived note re-filed into Guide' })
      setRefilingKey(null)
      window.dispatchEvent(new Event('guide-progress-updated'))
      await loadArchived()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Could not re-file note',
      })
    }
  }

  const handleDeleteArchived = async (note: ArchivedNote) => {
    const kitsApi = safeGetKitsApi()
    if (!kitId || !kitsApi?.deleteArchivedNote) return
    try {
      await kitsApi.deleteArchivedNote(kitId, {
        pillarId: note.pillarId,
        topicId: note.topicId,
        sectionId: note.sectionId,
      })
      addToast({ type: 'info', message: 'Archived note deleted' })
      await loadArchived()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Could not delete note',
      })
    }
  }

  const handleCopyArchived = async (content: string) => {
    try {
      await navigator.clipboard?.writeText(content)
      addToast({ type: 'success', message: 'Note copied to clipboard' })
    } catch {
      addToast({ type: 'info', message: 'Select text manually to copy' })
    }
  }

  const selectedRefilePillar = pillars.find((p) => p.id === targetPillarId)

  return (
    <div className="guide-layout" id="guide-page">
      {pillarId && <PillarNav dogears={dogears} />}

      <div className="guide-content">
        {!isMobile && pillarId && (
          <div className="guide-float-actions">
            {capabilities.calculator !== false && (
              <button
                type="button"
                className="btn btn-secondary floating-calc-btn"
                onClick={() => setCalcModalOpen(true)}
                title="BotE Calculator (⌘E)"
                aria-label="Open BotE Calculator"
                id="guide-calc-btn"
              >
                <Calculator size={16} />
              </button>
            )}
            {!chatOpen && (
              <button
                type="button"
                className="btn btn-primary floating-chat-btn inline-flex items-center gap-1.5"
                onClick={() => toggleChat('guide')}
              >
                <KitAvatar size={16} state="idle" />
                Ask AI
              </button>
            )}
          </div>
        )}

        {archivedNotes.length > 0 && (
          <div
            className="mx-4 mt-4 rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface-low)] p-3.5"
            data-testid="archived-notes-drawer"
          >
            <button
              type="button"
              onClick={() => setDrawerOpen((v) => !v)}
              className="flex w-full cursor-pointer items-center justify-between text-left text-xs font-semibold text-[var(--color-ink)]"
            >
              <span className="inline-flex items-center gap-2">
                <Archive size={15} className="text-[var(--color-brand)]" />
                Archived Notes ({archivedNotes.length}) — preserved from retired topics
              </span>
              {drawerOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            </button>

            {drawerOpen && (
              <div className="mt-3 space-y-2.5 border-t border-[var(--color-line)] pt-3">
                {archivedNotes.map((note) => {
                  const key = `${note.pillarId}__${note.topicId}__${note.sectionId}`
                  return (
                    <div
                      key={key}
                      className="space-y-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-card)] p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <code className="font-mono text-[11px] text-[var(--color-ink-muted)]">
                          {note.pillarId} / {note.topicId} / {note.sectionId}
                        </code>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => void handleCopyArchived(note.content)}
                          >
                            <Copy size={12} /> Copy
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => openRefilePicker(key)}
                          >
                            <FolderInput size={12} /> Re-file
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => void handleDeleteArchived(note)}
                          >
                            <Trash2 size={12} /> Delete
                          </button>
                        </div>
                      </div>

                      <pre className="max-h-36 overflow-y-auto rounded bg-[var(--color-surface-low)] p-2 font-mono text-xs whitespace-pre-wrap text-[var(--color-ink)]">
                        {note.content}
                      </pre>

                      {refilingKey === key && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <select
                            aria-label="Target pillar"
                            value={targetPillarId}
                            onChange={(e) => handlePillarTargetChange(e.target.value)}
                            className="input py-1 text-xs"
                          >
                            {pillars.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.shortName}
                              </option>
                            ))}
                          </select>
                          <select
                            aria-label="Target topic"
                            value={targetTopicId}
                            onChange={(e) => setTargetTopicId(e.target.value)}
                            className="input py-1 text-xs"
                          >
                            {(selectedRefilePillar?.topics || []).map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                          <select
                            aria-label="Target section"
                            value={targetSectionId}
                            onChange={(e) => setTargetSectionId(e.target.value)}
                            className="input py-1 text-xs"
                          >
                            {(selectedRefilePillar?.sections || []).map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={
                              !targetPillarId || !targetTopicId || !targetSectionId
                            }
                            onClick={() => void handleRefileNote(note)}
                          >
                            Move Note
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        <BlueprintShell
          dogears={dogears}
          onToggleDogear={handleToggleDogear}
          onAskKit={() => openGuideChat()}
        />
      </div>

      {pillarId && (!isMobile || chatOpen) && (
        <ChatPanel
          page="guide"
          title={`Ask about ${skeleton.identity.name}`}
          placeholder="Ask about this component..."
        />
      )}
    </div>
  )
}
