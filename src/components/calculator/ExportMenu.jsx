import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Share2, Copy, MessageSquare, BookOpen, Check, Loader2 } from 'lucide-react'
import useAppStore from '../../stores/appStore'
import { buildMarkdownSummary } from '../../utils/bote'
import { PILLARS, BLUEPRINT_SECTIONS } from '../../utils/constants'
import { guideContentApi } from '../../utils/api'

/** sessionStorage key LearningChat polls for a prefilled draft. */
export const CHAT_DRAFT_KEY = 'toolbox_chat_draft'

/**
 * 1-click export of the current estimate:
 *  - Copy Markdown (with LaTeX formulas) to the clipboard
 *  - Send to Chat (prefills the AI chat input)
 *  - Append to a Guide section (pillar → topic → section picker)
 */
export default function ExportMenu({ results, scenario, latencyBudget }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [guidePickerOpen, setGuidePickerOpen] = useState(false)
  const menuRef = useRef(null)
  const navigate = useNavigate()
  const setCalcModalOpen = useAppStore((s) => s.setCalcModalOpen)
  const addToast = useAppStore((s) => s.addToast)

  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false)
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
    navigate('/chat')
  }

  return (
    <div className="calc-export" ref={menuRef}>
      <button
        className="btn btn-secondary btn-sm"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        id="calc-export-btn"
      >
        <Share2 size={13} /> Export
      </button>

      {open && (
        <div className="calc-export-menu" role="menu">
          <button role="menuitem" className="calc-export-item" onClick={copyToClipboard}>
            {copied ? <Check size={14} /> : <Copy size={14} />} Copy Markdown
          </button>
          <button role="menuitem" className="calc-export-item" onClick={sendToChat}>
            <MessageSquare size={14} /> Send to Chat
          </button>
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

/** Small modal: choose pillar → topic → section, then append the summary. */
function GuidePicker({ markdown, onClose }) {
  const addToast = useAppStore((s) => s.addToast)
  const [pillarId, setPillarId] = useState('distributed-mechanics')
  const pillar = PILLARS.find((p) => p.id === pillarId) || PILLARS[0]
  const [topicId, setTopicId] = useState(pillar.topics[0]?.id)
  const sections = BLUEPRINT_SECTIONS[pillarId] || []
  const [sectionId, setSectionId] = useState(sections[0]?.id)
  const [isSaving, setIsSaving] = useState(false)

  const selectPillar = (id) => {
    const next = PILLARS.find((p) => p.id === id)
    setPillarId(id)
    setTopicId(next?.topics[0]?.id)
    setSectionId((BLUEPRINT_SECTIONS[id] || [])[0]?.id)
  }

  const save = async () => {
    if (!topicId || !sectionId || isSaving) return
    setIsSaving(true)
    try {
      // Append below any existing notes instead of replacing them.
      let existing = ''
      try {
        const current = await guideContentApi.getSection(pillarId, topicId, sectionId)
        existing = current?.content || ''
      } catch {
        // Section empty — nothing to preserve
      }
      const combined = existing ? `${existing}\n\n---\n\n${markdown}` : markdown
      await guideContentApi.upsert(pillarId, topicId, sectionId, combined)
      addToast({ type: 'success', message: 'Estimate saved to Guide notes' })
      onClose()
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to save to Guide' })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="calc-guide-picker-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="calc-guide-picker" role="dialog" aria-label="Save estimate to Guide">
        <div className="calc-guide-picker-title">Save estimate to Guide notes</div>
        <label className="calc-guide-picker-label">
          Pillar
          <select className="input" value={pillarId} onChange={(e) => selectPillar(e.target.value)}>
            {PILLARS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="calc-guide-picker-label">
          Topic
          <select className="input" value={topicId} onChange={(e) => setTopicId(e.target.value)}>
            {pillar.topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="calc-guide-picker-label">
          Section
          <select className="input" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <div className="calc-guide-picker-actions">
          <button className="btn btn-secondary btn-sm" onClick={onClose} disabled={isSaving}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={save} disabled={isSaving || !topicId || !sectionId}>
            {isSaving ? <Loader2 size={13} className="spin" /> : <BookOpen size={13} />}
            {isSaving ? 'Saving…' : 'Append to section'}
          </button>
        </div>
      </div>
    </div>
  )
}
