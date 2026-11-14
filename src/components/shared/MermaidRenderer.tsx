import { useEffect, useRef, useState, useId } from 'react'
import { createPortal } from 'react-dom'
import { Maximize2, Minimize2, Loader2 } from 'lucide-react'
import useAppStore from '../../stores/appStore'

const MERMAID_SECURE_KEYS = ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize']
const RENDER_DEBOUNCE_MS = 120

interface MermaidLike {
  initialize: (config: {
    startOnLoad: boolean
    theme: 'default' | 'dark'
    securityLevel: 'strict'
    secure: string[]
    fontFamily: string
  }) => void
  render: (id: string, text: string) => Promise<{ svg: string }>
}

const initializedThemeByInstance = new WeakMap<MermaidLike, 'default' | 'dark'>()

async function getMermaid(): Promise<MermaidLike> {
  const mod = (await import('mermaid')) as unknown as {
    default?: MermaidLike
  } & MermaidLike
  return mod.default ?? mod
}

export interface MermaidRendererProps {
  chart: string
}

/**
 * Renders a mermaid.js flowchart from raw syntax with strict XSS protection
 * and live light/dark theme sync. Dynamically imports `mermaid` on demand.
 */
export default function MermaidRenderer({ chart }: MermaidRendererProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [svgContent, setSvgContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const theme = useAppStore((s) => s.theme)

  const baseId = useId().replace(/[^A-Za-z0-9_-]/g, '')
  const renderSeqRef = useRef(0)

  useEffect(() => {
    if (!chart) return

    let isMounted = true
    renderSeqRef.current += 1
    const renderId = `mermaid-${baseId}-${renderSeqRef.current}`
    const targetTheme: 'default' | 'dark' = theme === 'light' ? 'default' : 'dark'

    const timer = setTimeout(() => {
      const renderChart = async () => {
        try {
          const mermaid = await getMermaid()
          if (initializedThemeByInstance.get(mermaid) !== targetTheme) {
            mermaid.initialize({
              startOnLoad: false,
              theme: targetTheme,
              securityLevel: 'strict',
              secure: MERMAID_SECURE_KEYS,
              fontFamily: 'Inter, system-ui, sans-serif',
            })
            initializedThemeByInstance.set(mermaid, targetTheme)
          }
          const { svg } = await mermaid.render(renderId, chart)
          if (isMounted) {
            setSvgContent(svg)
            setError(null)
          }
        } catch (err) {
          if (typeof document !== 'undefined') {
            document.getElementById(`d${renderId}`)?.remove()
          }
          if (isMounted) {
            console.error('Mermaid parsing error:', err)
            setError(err instanceof Error ? err.message : 'Failed to render diagram.')
          }
        }
      }

      void renderChart()
    }, RENDER_DEBOUNCE_MS)

    return () => {
      isMounted = false
      clearTimeout(timer)
    }
  }, [chart, theme, baseId])

  useEffect(() => {
    if (!isExpanded || typeof window === 'undefined') return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsExpanded(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isExpanded])

  if (error) {
    return (
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          padding: 'var(--space-4)',
          background: 'var(--color-error-subtle)',
          color: 'var(--color-error)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        <strong>Diagram Error:</strong>
        <pre style={{ fontSize: '10px', marginTop: 'var(--space-2)' }}>{error}</pre>
        <pre style={{ fontSize: '10px', marginTop: 'var(--space-2)', opacity: 0.7 }}>{chart}</pre>
      </div>
    )
  }

  const renderDiagramBody = (expandedView: boolean) =>
    svgContent ? (
      <div
        ref={expandedView ? undefined : containerRef}
        dangerouslySetInnerHTML={{ __html: svgContent }}
        style={{
          width: '100%',
          height: expandedView ? '100%' : 'auto',
          overflow: 'auto',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      />
    ) : (
      <div
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: 'var(--color-text-tertiary)',
            padding: 'var(--space-4)',
            fontSize: 'var(--text-xs)',
          }}
        >
          <Loader2 size={14} className="spin" />
          <span>Rendering diagram...</span>
        </div>
      </div>
    )

  return (
    <>
      <div
        className="mermaid-wrapper"
        style={{
          position: 'relative',
          width: '100%',
          zIndex: 1,
          background: 'var(--color-bg-tertiary)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '1em 0',
        }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setIsExpanded(true)
          }}
          style={{
            position: 'absolute',
            top: 'var(--space-2)',
            right: 'var(--space-2)',
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            padding: '4px',
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
            zIndex: 2,
          }}
          title="Expand Diagram"
          aria-label="Expand Diagram"
        >
          <Maximize2 size={14} />
        </button>

        {renderDiagramBody(false)}
      </div>

      {isExpanded &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="mermaid-wrapper expanded"
            role="dialog"
            aria-modal="true"
            aria-label="Expanded Mermaid diagram"
            onClick={(e) => {
              e.stopPropagation()
              if (e.target === e.currentTarget) setIsExpanded(false)
            }}
            style={{
              position: 'fixed',
              inset: 0,
              width: '100vw',
              height: '100vh',
              zIndex: 9999,
              background: 'rgba(0,0,0,0.8)',
              backdropFilter: 'blur(8px)',
              padding: 'var(--space-8)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setIsExpanded(false)
              }}
              style={{
                position: 'absolute',
                top: 'var(--space-4)',
                right: 'var(--space-4)',
                background: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                padding: '4px',
                color: 'var(--color-text-secondary)',
                cursor: 'pointer',
                zIndex: 2,
              }}
              title="Minimize"
              aria-label="Minimize Diagram"
            >
              <Minimize2 size={14} />
            </button>

            {renderDiagramBody(true)}
          </div>,
          document.body,
        )}
    </>
  )
}
