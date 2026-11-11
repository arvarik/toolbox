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
          <h1 className="page-title font-serif">
            BotE Calculator
          </h1>
          <p className="page-description">
            Live capacity estimation for traffic, storage, cache, bandwidth, and hardware.
          </p>
        </div>
      </div>
      <CalculatorSandbox />
    </div>
  )
}
