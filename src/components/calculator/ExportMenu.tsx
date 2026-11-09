import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Share2, Copy, MessageSquare, BookOpen, Check, Loader2, Layers } from 'lucide-react'
import useAppStore from '../../stores/appStore'
import { useActiveKit, useKitRoutePrefix } from '../../stores/useKitStore'
import { buildMarkdownSummary, formatCount } from '../../utils/bote'
import { guideContentApi } from '../../utils/api'
import {
  readStoreNodes,
  writeStoreGraph,
  type BuilderFlowNode,
} from '../builder/boardModel'
import type { BoteEstimates, BoteScenario } from './AuditPanel'
import type { LatencyBudgetItem } from './LatencyReference'

/** sessionStorage key LearningChat polls for a prefilled draft. */
export const CHAT_DRAFT_KEY = 'toolbox_chat_draft'

export interface ExportMenuProps {
  results: BoteEstimates
  scenario: BoteScenario
  latencyBudget: LatencyBudgetItem[]
}

/**
 * 1-click export of the current estimate:
 *  - Copy Markdown (with LaTeX formulas) to the clipboard
 *  - Send to Chat (prefills the AI chat input)
 *  - Append to a Guide section (pillar → topic → section picker)
 *  - Export to Whiteboard Canvas (adds an Observability node with metrics)
 */
export default function ExportMenu({ results, scenario, latencyBudget }: ExportMenuProps) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [guidePickerOpen, setGuidePickerOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const navigate = useNavigate()
  const { capabilities } = useActiveKit()
  const prefix = useKitRoutePrefix()
  const setCalcModalOpen = useAppStore((s) => s.setCalcModalOpen)
  const addToast = useAppStore((s) => s.addToast)

  const canvasCapability = capabilities?.canvas ?? 'architecture'

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (menuRef.current && e.target instanceof Node && !menuRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const markdown = () =>
    buildMarkdownSummary(results, { scenarioName: scenario.name, latencyBudget })

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(markdown())
      setCopied(true)
      addToast({ type: 'success', message: 'Estimate copied as Markdown' })
      setTimeout(() => setCopied(false), 1500)
    } catch {
      addToast({ type: 'error', message: 'Clipboard unavailable in this browser' })
    }
    setOpen(false)
  }

  const sendToChat = () => {
    try {
      sessionStorage.setItem(
        CHAT_DRAFT_KEY,
        `Here is my back-of-the-envelope estimate. Challenge my assumptions:\n\n${markdown()}`
      )
    } catch {
      // Session storage full/blocked — the chat page will just open empty.
    }
    window.dispatchEvent(new CustomEvent('toolbox-chat-draft'))
    setOpen(false)
    setCalcModalOpen(false)
    navigate(`${prefix}/chat`)
  }

  const exportToWhiteboard = () => {
    const existingNodes = readStoreNodes(useAppStore.getState())
    const peakStr = Number.isFinite(results?.peakTotalQps)
      ? `${formatCount(results.peakTotalQps)} QPS`
      : 'Metrics'
    const label = `${scenario?.name || 'Estimate'}: ${peakStr}`
    const newNode: BuilderFlowNode = {
      id: `calc-metrics-${Date.now()}`,
      type: 'component',
      position: { x: 260, y: 140 + (existingNodes.length % 6) * 60 },
      data: {
        name: label,
        icon: 'bar-chart',
        category: 'Observability',
      },
    }
    writeStoreGraph({ nodes: [...existingNodes, newNode] })
    const isConcept = canvasCapability === 'concept'
    addToast({
      type: 'success',
      message: isConcept
        ? 'Estimate exported to Concept Canvas'
        : 'Estimate exported to Architecture Canvas',
    })
    setOpen(false)
    setCalcModalOpen(false)
    navigate(`${prefix}/${isConcept ? 'canvas' : 'builder'}`)
  }

  return (
    <div className="calc-export" ref={menuRef}>
      <button
        className="calc-export-btn btn btn-secondary btn-sm"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        id="calc-export-btn"
      >
        <Share2 size={13} /> Export
      </button>

      {open && (
        <div className="calc-export-menu" role="menu">
          <button role="menuitem" className="calc-export-item" onClick={() => void copyToClipboard()}>
            {copied ? <Check size={14} /> : <Copy size={14} />} Copy Markdown
          </button>
          <button role="menuitem" className="calc-export-item" onClick={sendToChat}>
            <MessageSquare size={14} /> Send to Chat
          </button>
          {canvasCapability !== 'none' && (
            <button
              role="menuitem"
              className="calc-export-item"
              onClick={exportToWhiteboard}
              id="calc-export-canvas-btn"
            >
              <Layers size={14} /> Export to Canvas
            </button>
          )}
          <button
            role="menuitem"
            className="calc-export-item"
            onClick={() => { setOpen(false); setGuidePickerOpen(true) }}
          >
            <BookOpen size={14} /> Save to Guide notes…
          </button>
        </div>
      )}

      {guidePickerOpen && (
        <GuidePicker
          markdown={markdown()}
          onClose={() => setGuidePickerOpen(false)}
        />
      )}
    </div>
  )
}

interface GuidePickerProps {
  markdown: string
  onClose: () => void
}

/** Small modal: choose pillar → topic → section, then append the summary. */
function GuidePicker({ markdown, onClose }: GuidePickerProps) {
  const addToast = useAppStore((s) => s.addToast)
  // The active kit, or the System Design fallback, always has at least one pillar.
  const { pillars: activePillars, sectionsByPillar } = useActiveKit()
  const resolveSections = (pId: string) => sectionsByPillar[pId] || []

  const defaultPillar =
    activePillars.find((p) => p.id === 'distributed-mechanics') || activePillars[0]
  const [pillarId, setPillarId] = useState<string>(defaultPillar?.id ?? '')
  const pillar = activePillars.find((p) => p.id === pillarId) || activePillars[0]
  const [topicId, setTopicId] = useState<string>(pillar?.topics[0]?.id ?? '')
  const sections = resolveSections(pillar?.id ?? pillarId)
  const [sectionId, setSectionId] = useState<string>(sections[0]?.id ?? '')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!activePillars.some((p) => p.id === pillarId)) {
      const fallback = activePillars[0]
      const nextPid = fallback?.id ?? ''
      setPillarId(nextPid)
      setTopicId(fallback?.topics[0]?.id ?? '')
      setSectionId(resolveSections(nextPid)[0]?.id ?? '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePillars])

  const selectPillar = (id: string) => {
    const next = activePillars.find((p) => p.id === id)
    setPillarId(id)
    setTopicId(next?.topics[0]?.id ?? '')
    setSectionId(resolveSections(id)[0]?.id ?? '')
  }

  const save = async () => {
    if (!pillarId || !topicId || !sectionId || isSaving) return
    setIsSaving(true)
    try {
      let existing = ''
      try {
        const current = (await guideContentApi.getSection(pillarId, topicId, sectionId)) as {
          content?: string
        } | null
        existing = current?.content || ''
      } catch {
        // Section empty — nothing to preserve
      }
      const combined = existing ? `${existing}\n\n---\n\n${markdown}` : markdown
      await guideContentApi.upsert(pillarId, topicId, sectionId, combined)
      window.dispatchEvent(new Event('guide-progress-updated'))
      addToast({ type: 'success', message: 'Estimate saved to Guide notes' })
      onClose()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error && err.message ? err.message : 'Failed to save to Guide',
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div
      className="calc-guide-picker-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="calc-guide-picker" role="dialog" aria-label="Save estimate to Guide">
        <div className="calc-guide-picker-title">Save estimate to Guide notes</div>
        <label className="calc-guide-picker-label">
          Pillar
          <select className="input" value={pillarId} onChange={(e) => selectPillar(e.target.value)}>
            {activePillars.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="calc-guide-picker-label">
          Topic
          <select className="input" value={topicId} onChange={(e) => setTopicId(e.target.value)}>
            {(pillar?.topics || []).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
        <label className="calc-guide-picker-label">
          Section
          <select className="input" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <div className="calc-guide-picker-actions">
          <button className="btn btn-secondary btn-sm" onClick={onClose} disabled={isSaving}>
            Cancel
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => void save()}
            disabled={isSaving || !pillarId || !topicId || !sectionId}
          >
            {isSaving ? <Loader2 size={13} className="spin" /> : <BookOpen size={13} />}
            {isSaving ? 'Saving…' : 'Append to section'}
          </button>
        </div>
      </div>
    </div>
  )
}
