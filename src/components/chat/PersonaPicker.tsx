import { useState, useEffect, useRef, useMemo } from 'react'
import { ChevronDown } from 'lucide-react'
import { buildPersonasForKit, type PersonaId } from './personas'
import { useActiveKit } from '../../stores/useKitStore'

interface PersonaPickerProps {
  activeId: PersonaId
  onSelect: (id: PersonaId) => void
}

/**
 * PersonaPicker Dropdown — switches between the 4 tutoring styles.
 */
export default function PersonaPicker({ activeId, onSelect }: PersonaPickerProps) {
  const [open, setOpen] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)
  const { kit, skeleton, tutor } = useActiveKit()
  const isCustomKit = Boolean(kit && skeleton.identity.slug !== 'system-design')
  const personas = useMemo(
    () => buildPersonasForKit(tutor, isCustomKit),
    [tutor, isCustomKit],
  )

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && e.target instanceof Node && !dropRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const current = personas[activeId] || personas.socratic

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
          display: 'flex', flexDirection: 'column',
        }}>
          {Object.values(personas).map((p) => (
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
                fontSize: 'var(--text-sm)', fontWeight: p.id === activeId ? 600 : 400,
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
