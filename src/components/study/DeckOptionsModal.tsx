import { useEffect, useState } from 'react'
import Modal from '../shared/Modal'
import { Save, RotateCcw } from 'lucide-react'

export interface DeckSchedulerSettings {
  new_limit: number
  review_limit: number
  steps: string
  lapse_steps: string
  easy_bonus: number
}

export interface DeckOptionsTarget {
  id: string
  name: string
  settings?: Partial<DeckSchedulerSettings>
}

export interface DeckOptionsModalProps {
  open: boolean
  onClose: () => void
  deck: DeckOptionsTarget | null
  onSave: (settings: DeckSchedulerSettings) => void
}

const DEFAULT_SETTINGS: DeckSchedulerSettings = {
  new_limit: 20,
  review_limit: 200,
  steps: '1m 10m',
  lapse_steps: '10m',
  easy_bonus: 1.3,
}

export default function DeckOptionsModal({
  open,
  onClose,
  deck,
  onSave,
}: DeckOptionsModalProps) {
  const settings = { ...DEFAULT_SETTINGS, ...(deck?.settings || {}) }

  const [newLimit, setNewLimit] = useState<string>(String(settings.new_limit))
  const [reviewLimit, setReviewLimit] = useState<string>(String(settings.review_limit))
  const [steps, setSteps] = useState<string>(settings.steps)
  const [lapseSteps, setLapseSteps] = useState<string>(settings.lapse_steps)
  const [easyBonus, setEasyBonus] = useState<string>(String(settings.easy_bonus))

  // Sync form fields whenever a different deck is opened
  useEffect(() => {
    const next = { ...DEFAULT_SETTINGS, ...(deck?.settings || {}) }
    setNewLimit(String(next.new_limit))
    setReviewLimit(String(next.review_limit))
    setSteps(next.steps)
    setLapseSteps(next.lapse_steps)
    setEasyBonus(String(next.easy_bonus))
  }, [deck?.id, deck?.settings, open])

  const handleReset = () => {
    setNewLimit(String(DEFAULT_SETTINGS.new_limit))
    setReviewLimit(String(DEFAULT_SETTINGS.review_limit))
    setSteps(DEFAULT_SETTINGS.steps)
    setLapseSteps(DEFAULT_SETTINGS.lapse_steps)
    setEasyBonus(String(DEFAULT_SETTINGS.easy_bonus))
  }

  const handleSave = () => {
    const parsedNew = Number.parseInt(newLimit, 10)
    const parsedReview = Number.parseInt(reviewLimit, 10)
    const parsedBonus = Number.parseFloat(easyBonus)
    onSave({
      new_limit: Number.isNaN(parsedNew) ? 20 : parsedNew,
      review_limit: Number.isNaN(parsedReview) ? 200 : parsedReview,
      steps: steps.trim() || '1m 10m',
      lapse_steps: lapseSteps.trim() || '10m',
      easy_bonus: Number.isNaN(parsedBonus) ? 1.3 : parsedBonus,
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Options: ${deck?.name ?? ''}`}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
          <button className="btn btn-ghost" onClick={handleReset} style={{ gap: 6 }}>
            <RotateCcw size={14} />
            Reset Defaults
          </button>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleSave} style={{ gap: 6 }}>
              <Save size={14} />
              Save
            </button>
          </div>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div className="settings-field">
          <label className="settings-label" style={{ fontWeight: 600 }}>Daily Limits</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', marginTop: 'var(--space-1)' }}>
            <div>
              <label style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginBottom: 4, display: 'block' }}>
                New cards / day
              </label>
              <input
                type="number"
                className="input"
                min="0"
                value={newLimit}
                onChange={(e) => setNewLimit(e.target.value)}
              />
            </div>
            <div>
              <label style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginBottom: 4, display: 'block' }}>
                Maximum reviews / day
              </label>
              <input
                type="number"
                className="input"
                min="0"
                value={reviewLimit}
                onChange={(e) => setReviewLimit(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="settings-field">
          <label className="settings-label" style={{ fontWeight: 600 }}>Learning Steps</label>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-2)' }}>
            Space-separated intervals. Use &apos;m&apos; for minutes and &apos;h&apos; for hours (e.g. 1m 10m).
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <div>
              <label style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginBottom: 4, display: 'block' }}>
                New card steps
              </label>
              <input
                type="text"
                className="input"
                placeholder="1m 10m"
                value={steps}
                onChange={(e) => setSteps(e.target.value)}
              />
            </div>
            <div>
              <label style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginBottom: 4, display: 'block' }}>
                Lapse relearning steps
              </label>
              <input
                type="text"
                className="input"
                placeholder="10m"
                value={lapseSteps}
                onChange={(e) => setLapseSteps(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="settings-field">
          <label className="settings-label" style={{ fontWeight: 600 }}>Advanced Scheduler Parameters</label>
          <div style={{ marginTop: 'var(--space-1)' }}>
            <label style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginBottom: 4, display: 'block' }}>
              Easy Bonus multiplier
            </label>
            <input
              type="number"
              step="0.1"
              min="1.0"
              className="input"
              style={{ maxWidth: '50%' }}
              value={easyBonus}
              onChange={(e) => setEasyBonus(e.target.value)}
            />
          </div>
        </div>
      </div>
    </Modal>
  )
}
