import { X, Keyboard } from 'lucide-react'

export default function KeyboardShortcutsModal({ open, onClose }) {
  if (!open) return null

  const shortcuts = [
    {
      category: 'Global Navigation',
      items: [
        { label: 'Chat', keys: ['⌘', '1'] },
        { label: 'Guide', keys: ['⌘', '2'] },
        { label: 'Builder', keys: ['⌘', '3'] },
        { label: 'Flashcards', keys: ['⌘', '4'] },
        { label: 'Feynman', keys: ['⌘', '5'] },
        { label: 'Interleaved', keys: ['⌘', '6'] },
        { label: 'Settings', keys: ['⌘', ','] },
        { label: 'Global Search', keys: ['⌘', '/'] },
        { label: 'Toggle Sidebar', keys: ['⌘', '\\'] },
      ]
    },
    {
      category: 'Study & Flashcards',
      items: [
        { label: 'Flip Card / Submit', keys: ['Space'] },
        { label: 'Rate: Again', keys: ['1'] },
        { label: 'Rate: Hard', keys: ['2'] },
        { label: 'Rate: Good', keys: ['3'] },
        { label: 'Rate: Easy', keys: ['4'] },
      ]
    },
    {
      category: 'Chat',
      items: [
        { label: 'Send Message', keys: ['Enter'] },
        { label: 'New Line', keys: ['Shift', 'Enter'] },
      ]
    }
  ]

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal-content" 
        onClick={(e) => e.stopPropagation()} 
        style={{ maxWidth: 500, width: '90%' }}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Keyboard size={20} className="text-accent" />
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Keyboard Shortcuts</h2>
          </div>
          <button className="close-btn" onClick={onClose} aria-label="Close shortcuts">
            <X size={20} />
          </button>
        </div>
        
        <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
            {shortcuts.map((section, idx) => (
              <div key={idx}>
                <h3 style={{ 
                  fontSize: '0.85rem', 
                  textTransform: 'uppercase', 
                  color: 'var(--color-text-tertiary)', 
                  fontWeight: 700, 
                  letterSpacing: '0.05em',
                  marginBottom: 'var(--space-3)' 
                }}>
                  {section.category}
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {section.items.map((item, itemIdx) => (
                    <div key={itemIdx} style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center',
                      padding: 'var(--space-2) 0',
                      borderBottom: itemIdx < section.items.length - 1 ? '1px solid var(--color-border)' : 'none'
                    }}>
                      <span style={{ color: 'var(--color-text-primary)' }}>{item.label}</span>
                      <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                        {item.keys.map((k, kIdx) => (
                          <kbd key={kIdx} style={{
                            background: 'var(--color-bg-secondary)',
                            border: '1px solid var(--color-border)',
                            borderRadius: '4px',
                            padding: '2px 6px',
                            fontSize: '0.75rem',
                            fontFamily: 'monospace',
                            color: 'var(--color-text-secondary)',
                            minWidth: 24,
                            textAlign: 'center'
                          }}>{k}</kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
