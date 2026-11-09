import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import {
  MessageSquare,
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
import useAppStore from '../stores/appStore'
import { useActiveKit } from '../stores/useKitStore'
import useIsMobile from '../hooks/useIsMobile'
import * as apiModule from '../utils/api'

function safeGetKitsApi() {
  try {
    return apiModule?.kitsApi ?? null
  } catch {
    return null
  }
}

/**
 * GuidePage — The authoritative library of study kit knowledge.
 */
export default function GuidePage() {
  const { pillarId } = useParams()
  const chatOpen = useAppStore((s) => s.chatOpen.guide)
  const toggleChat = useAppStore((s) => s.toggleChat)
  const setCalcModalOpen = useAppStore((s) => s.setCalcModalOpen)
  const addToast = useAppStore((s) => s.addToast)
  const { kitId, skeleton, pillars, capabilities } = useActiveKit()

  const isMobile = useIsMobile()

  const [archivedNotes, setArchivedNotes] = useState([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [refilingKey, setRefilingKey] = useState(null)
  const [targetPillarId, setTargetPillarId] = useState('')
  const [targetTopicId, setTargetTopicId] = useState('')
  const [targetSectionId, setTargetSectionId] = useState('')

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
    void loadArchived()
  }, [loadArchived])

  const openRefilePicker = (key) => {
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

  const handlePillarTargetChange = (nextPid) => {
    const p = pillars.find((item) => item.id === nextPid)
    setTargetPillarId(nextPid)
    setTargetTopicId(p?.topics?.[0]?.id || '')
    setTargetSectionId(p?.sections?.[0]?.id || '')
  }

  const handleRefileNote = async (note) => {
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
      await loadArchived()
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Could not re-file note' })
    }
  }

  const handleDeleteArchived = async (note) => {
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
      addToast({ type: 'error', message: err.message || 'Could not delete note' })
    }
  }

  const handleCopyArchived = async (content) => {
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
      {/* Left: Pillar navigation */}
      {pillarId && <PillarNav />}

      {/* Center: Blueprint content (or library overview if no pillar) */}
      <div className="guide-content">
        {/* Floating Ask AI button — only in blueprint view on desktop */}
        {!isMobile && pillarId && (
          <div className="guide-float-actions">
            {capabilities.calculator !== false && (
              <button
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
                className="btn btn-primary floating-chat-btn"
                onClick={() => toggleChat('guide')}
              >
                <MessageSquare size={16} />
                Ask AI
              </button>
            )}
          </div>
        )}

        {/* Archived Notes Drawer — surfaces orphaned notes after upstream curriculum sync */}
        {archivedNotes.length > 0 && (
          <div
            className="mx-4 mt-4 rounded-xl border border-outline-variant bg-surface-container-low p-3.5"
            data-testid="archived-notes-drawer"
          >
            <button
              type="button"
              onClick={() => setDrawerOpen((v) => !v)}
              className="w-full flex items-center justify-between text-left text-xs font-semibold text-on-surface"
            >
              <span className="inline-flex items-center gap-2">
                <Archive size={15} className="text-primary" />
                Archived Notes ({archivedNotes.length}) — preserved from retired topics
              </span>
              {drawerOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            </button>

            {drawerOpen && (
              <div className="mt-3 space-y-2.5 border-t border-outline-variant pt-3">
                {archivedNotes.map((note) => {
                  const key = `${note.pillarId}__${note.topicId}__${note.sectionId}`
                  return (
                    <div
                      key={key}
                      className="rounded-lg border border-outline-variant bg-surface p-3 space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <code className="text-[11px] text-on-surface-variant">
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

                      <pre className="text-xs text-on-surface whitespace-pre-wrap max-h-36 overflow-y-auto bg-surface-container-low rounded p-2">
                        {note.content}
                      </pre>

                      {refilingKey === key && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <select
                            aria-label="Target pillar"
                            value={targetPillarId}
                            onChange={(e) => handlePillarTargetChange(e.target.value)}
                            className="input text-xs py-1"
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
                            className="input text-xs py-1"
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
                            className="input text-xs py-1"
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
                            disabled={!targetPillarId || !targetTopicId || !targetSectionId}
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

        <BlueprintShell />
      </div>

      {/* Right: AI Chat panel — only when viewing a specific pillar/topic */}
      {!isMobile && pillarId && (
        <ChatPanel
          page="guide"
          title={`Ask about ${skeleton.identity.name}`}
          placeholder="Ask about this component..."
        />
      )}
    </div>
  )
}
