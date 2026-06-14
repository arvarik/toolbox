import { useState } from 'react'
import Modal from '../shared/Modal'
import { Save, RotateCcw } from 'lucide-react'

export default function DeckOptionsModal({ open, onClose, deck, onSave }) {
  const settings = deck?.settings || {
    new_limit: 20,
    review_limit: 200,
    steps: '1m 10m',
    lapse_steps: '10m',
    easy_bonus: 1.3
  }

  const [newLimit, setNewLimit] = useState(settings.new_limit)
  const [reviewLimit, setReviewLimit] = useState(settings.review_limit)
  const [steps, setSteps] = useState(settings.steps)
  const [lapseSteps, setLapseSteps] = useState(settings.lapse_steps)
  const [easyBonus, setEasyBonus] = useState(settings.easy_bonus)

  const handleReset = () => {
    setNewLimit(20)
    setReviewLimit(200)
    setSteps('1m 10m')
    setLapseSteps('10m')
    setEasyBonus(1.3)
  }

  const handleSave = () => {
    onSave({
      new_limit: parseInt(newLimit) || 20,
      review_limit: parseInt(reviewLimit) || 200,
      steps: steps.trim() || '1m 10m',
      lapse_steps: lapseSteps.trim() || '10m',
      easy_bonus: parseFloat(easyBonus) || 1.3
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Options: ${deck?.name}`}
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
            Space-separated intervals. Use 'm' for minutes and 'h' for hours (e.g. 1m 10m).
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
