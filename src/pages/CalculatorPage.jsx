import { Calculator } from 'lucide-react'
import CalculatorSandbox from '../components/calculator/CalculatorSandbox'

/**
 * Full-page Back-of-the-Envelope sandbox (/calculator).
 * State lives in useCalcStore, so numbers survive navigation and stay
 * in sync with the quick-access modal on other pages.
 */
export default function CalculatorPage() {
  return (
    <div className="page-wrapper calc-page" id="calculator-page">
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Calculator size={22} style={{ color: 'var(--color-accent)' }} />
            BotE Calculator
          </h1>
          <p className="page-subtitle">
            Back-of-the-envelope capacity estimation — traffic, storage, cache, bandwidth, and hardware, recalculated live.
          </p>
        </div>
      </div>
      <CalculatorSandbox />
    </div>
  )
}
