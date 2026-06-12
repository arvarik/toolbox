import { Component } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

/**
 * React Error Boundary — catches render errors and shows a recovery UI.
 * Wraps around page-level components to prevent full app crashes.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            padding: 'var(--space-8)',
            textAlign: 'center',
            gap: 'var(--space-4)',
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 'var(--radius-xl)',
              background: 'var(--color-error-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <AlertTriangle size={24} style={{ color: 'var(--color-error)' }} />
          </div>
          <h2
            style={{
              fontSize: 'var(--text-lg)',
              fontWeight: 700,
              color: 'var(--color-text-primary)',
            }}
          >
            Something went wrong
          </h2>
          <p
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-secondary)',
              maxWidth: 400,
            }}
          >
            An unexpected error occurred. Try refreshing the page or click below to recover.
          </p>
          {this.state.error && (
            <pre
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-error)',
                background: 'var(--color-error-subtle)',
                padding: 'var(--space-3)',
                borderRadius: 'var(--radius-md)',
                maxWidth: 500,
                overflow: 'auto',
                textAlign: 'left',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {this.state.error.message}
            </pre>
          )}
          <button
            className="btn btn-primary"
            onClick={this.handleReset}
            style={{ marginTop: 'var(--space-2)' }}
          >
            <RotateCcw size={14} />
            Try Again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
