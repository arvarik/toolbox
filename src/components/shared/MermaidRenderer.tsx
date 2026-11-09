import { useEffect, useRef, useState, useId } from 'react'
import { Maximize2, Minimize2, Loader2 } from 'lucide-react'
import useAppStore from '../../stores/appStore'

const MERMAID_SECURE_KEYS = ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize']

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

    const renderChart = async () => {
      try {
        const mermaid = await getMermaid()
        mermaid.initialize({
          startOnLoad: false,
          theme: theme === 'light' ? 'default' : 'dark',
          securityLevel: 'strict',
          secure: MERMAID_SECURE_KEYS,
          fontFamily: 'Inter, system-ui, sans-serif',
        })
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
    return () => {
      isMounted = false
    }
  }, [chart, theme, baseId])

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

  return (
    <div
      className={`mermaid-wrapper ${isExpanded ? 'expanded' : ''}`}
      onClick={(e) => {
        if (isExpanded) e.stopPropagation()
      }}
      style={{
        position: isExpanded ? 'fixed' : 'relative',
        top: isExpanded ? 0 : 'auto',
        left: isExpanded ? 0 : 'auto',
        width: isExpanded ? '100vw' : '100%',
        height: isExpanded ? '100vh' : 'auto',
        zIndex: isExpanded ? 9999 : 1,
        background: isExpanded ? 'rgba(0,0,0,0.8)' : 'var(--color-bg-tertiary)',
        backdropFilter: isExpanded ? 'blur(8px)' : 'none',
        borderRadius: isExpanded ? 0 : 'var(--radius-md)',
        padding: isExpanded ? 'var(--space-8)' : 'var(--space-4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        margin: isExpanded ? 0 : '1em 0',
        transition: 'all 0.2s ease-out',
      }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setIsExpanded(!isExpanded)
        }}
        style={{
          position: 'absolute',
          top: isExpanded ? 'var(--space-4)' : 'var(--space-2)',
          right: isExpanded ? 'var(--space-4)' : 'var(--space-2)',
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          padding: '4px',
          color: 'var(--color-text-secondary)',
          cursor: 'pointer',
          zIndex: 2,
        }}
        title={isExpanded ? 'Minimize' : 'Expand Diagram'}
      >
        {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>

      {svgContent ? (
        <div
          ref={containerRef}
          dangerouslySetInnerHTML={{ __html: svgContent }}
          style={{
            width: '100%',
            height: isExpanded ? '100%' : 'auto',
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
      )}
    </div>
  )
}
