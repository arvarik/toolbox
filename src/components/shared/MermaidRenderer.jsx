import { useEffect, useRef, useState, useId } from 'react'
import mermaid from 'mermaid'
import { Maximize2, Minimize2 } from 'lucide-react'

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose',
  fontFamily: 'Inter, system-ui, sans-serif'
})

export default function MermaidRenderer({ chart }) {
  const containerRef = useRef(null)
  const [svgContent, setSvgContent] = useState('')
  const [error, setError] = useState(null)
  const [isExpanded, setIsExpanded] = useState(false)
  
  // Use a unique ID for each chart to avoid collisions
  const baseId = useId().replace(/:/g, '')
  const idRef = useRef(`mermaid-${baseId}`)

  useEffect(() => {
    if (!chart) return
    
    let isMounted = true

    const renderChart = async () => {
      try {
        const { svg } = await mermaid.render(idRef.current, chart)
        if (isMounted) {
          setSvgContent(svg)
          setError(null)
        }
      } catch (err) {
        if (isMounted) {
          console.error("Mermaid parsing error:", err)
          setError(err.message || "Failed to render diagram.")
        }
      }
    }

    renderChart()
    return () => { isMounted = false }
  }, [chart])

  if (error) {
    return (
      <div style={{ padding: 'var(--space-4)', background: 'var(--color-error-subtle)', color: 'var(--color-error)', borderRadius: 'var(--radius-md)' }}>
        <strong>Diagram Error:</strong>
        <pre style={{ fontSize: '10px', marginTop: 'var(--space-2)' }}>{error}</pre>
        <pre style={{ fontSize: '10px', marginTop: 'var(--space-2)', opacity: 0.7 }}>{chart}</pre>
      </div>
    )
  }

  return (
    <div 
      className={`mermaid-wrapper ${isExpanded ? 'expanded' : ''}`}
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
        transition: 'all 0.2s ease-out'
      }}
    >
      <button 
        onClick={() => setIsExpanded(!isExpanded)}
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
        title={isExpanded ? "Minimize" : "Expand Diagram"}
      >
        {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>

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
    </div>
  )
}
