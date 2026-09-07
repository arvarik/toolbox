import { useState, useEffect, useRef } from 'react'
import { ChevronDown } from 'lucide-react'
import { PERSONAS } from './personas'

/**
 * PersonaPicker Dropdown — switches between the 4 tutoring styles.
 */
export default function PersonaPicker({ activeId, onSelect }) {
  const [open, setOpen] = useState(false)
  const dropRef = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const current = PERSONAS[activeId]

  return (
    <div ref={dropRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="persona-picker-btn"
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-full)',
          padding: '4px 12px',
          cursor: 'pointer', color: 'var(--color-text-primary)',
          fontSize: 'var(--text-xs)', fontWeight: 600,
          transition: 'border-color 0.2s',
        }}
        title="Change AI Persona"
      >
        <span>{current?.icon}</span>
        <span className="hide-on-mobile" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {current?.name}
        </span>
        <ChevronDown size={12} className="hide-on-mobile" style={{ flexShrink: 0, opacity: 0.6 }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          minWidth: 200, zIndex: 200, overflow: 'hidden',
          display: 'flex', flexDirection: 'column'
        }}>
          {Object.values(PERSONAS).map((p) => (
            <button
              key={p.id}
              onClick={() => { onSelect(p.id); setOpen(false) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                padding: 'var(--space-3) var(--space-4)',
                background: p.id === activeId ? 'var(--color-accent-subtle)' : 'transparent',
                border: 'none', borderBottom: '1px solid var(--color-border)',
                cursor: 'pointer', textAlign: 'left',
                color: p.id === activeId ? 'var(--color-accent)' : 'var(--color-text-primary)',
                fontSize: 'var(--text-sm)', fontWeight: p.id === activeId ? 600 : 400
              }}
              onMouseEnter={(e) => { if (p.id !== activeId) e.currentTarget.style.background = 'var(--color-bg-hover)' }}
              onMouseLeave={(e) => { if (p.id !== activeId) e.currentTarget.style.background = 'transparent' }}
            >
              <span>{p.icon}</span>
              <span>{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
