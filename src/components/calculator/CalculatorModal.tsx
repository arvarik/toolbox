import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { X, Calculator, Maximize2 } from 'lucide-react'
import useAppStore from '../../stores/appStore'
import { useActiveKit, useKitRoutePrefix } from '../../stores/useKitStore'
import CalculatorSandbox from './CalculatorSandbox'

/**
 * Quick-access BotE calculator, rendered globally so it opens on any
 * page (Chat, Guide, Builder, …). Shares state with /calculator through
 * useCalcStore. Toggled with ⌘⇧E or the header buttons.
 */
export default function CalculatorModal() {
  const open = useAppStore((s) => s.calcModalOpen)
  const setOpen = useAppStore((s) => s.setCalcModalOpen)
  const { capabilities } = useActiveKit()
  const prefix = useKitRoutePrefix()
  const navigate = useNavigate()
  const location = useLocation()

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, setOpen])

  const isCalculatorRoute =
    location.pathname.startsWith('/calculator') ||
    /^\/k\/[^/]+\/calculator(?:\/|$)/.test(location.pathname)

  // Suppress on the full calculator page or when the active Kit disables calculator.
  if (!open || capabilities?.calculator === false || isCalculatorRoute) return null

  return (
    <div
      className="calc-modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
    >
      <div className="calc-modal" role="dialog" aria-label="BotE Calculator" id="calc-modal">
        <div className="calc-modal-header">
          <div className="calc-modal-title">
            <Calculator size={16} style={{ color: 'var(--color-accent)' }} />
            BotE Calculator
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
            <button
              className="btn btn-ghost btn-icon btn-sm"
              onClick={() => {
                setOpen(false)
                navigate(`${prefix}/calculator`)
              }}
              title="Open full sandbox"
              aria-label="Open full sandbox"
            >
              <Maximize2 size={14} />
            </button>
            <button
              className="btn btn-ghost btn-icon btn-sm"
              onClick={() => setOpen(false)}
              aria-label="Close calculator"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="calc-modal-body">
          <CalculatorSandbox compact />
        </div>
      </div>
    </div>
  )
}
