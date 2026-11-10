import { useEffect } from 'react'
import { X, Keyboard } from 'lucide-react'
import { Kbd } from '../ui'

export interface KeyboardShortcutsModalProps {
  open: boolean
  onClose?: () => void
}

const SHORTCUT_SECTIONS = [
  {
    category: 'Global Navigation',
    items: [
      { label: 'Learn', keys: ['⌘', '1'] },
      { label: 'Guide', keys: ['⌘', '2'] },
      { label: 'Architecture / Concept Map', keys: ['⌘', '3'] },
      { label: 'Flashcards', keys: ['⌘', '4'] },
      { label: 'Feynman', keys: ['⌘', '5'] },
      { label: 'Interleaved', keys: ['⌘', '6'] },
      { label: 'Knowledge Graph', keys: ['⌘', '7'] },
      { label: 'BotE Calculator', keys: ['⌘', '8'] },
      { label: 'Quick Calculator', keys: ['⌘', 'E'] },
      { label: 'Toggle Pomodoro', keys: ['⌘', '9'] },
      { label: 'Settings', keys: ['⌘', ','] },
      { label: 'Command Palette / Search', keys: ['⌘', '/'] },
      { label: 'Show Shortcut Sheet', keys: ['⌘', '?'] },
      { label: 'Contextual Chat Panel', keys: ['⌘', 'J'] },
      { label: 'Toggle Sidebar', keys: ['⌘', 'B'] },
    ],
  },
  {
    category: 'Study & Flashcards',
    items: [
      { label: 'Flip Card / Reveal', keys: ['Space'] },
      { label: 'Rate: Again', keys: ['1'] },
      { label: 'Rate: Hard', keys: ['2'] },
      { label: 'Rate: Good', keys: ['3'] },
      { label: 'Rate: Easy', keys: ['4'] },
    ],
  },
  {
    category: 'Learn & Composer',
    items: [
      { label: 'Send Message', keys: ['Enter'] },
      { label: 'New Line', keys: ['Shift', 'Enter'] },
    ],
  },
] as const

export default function KeyboardShortcutsModal({ open, onClose }: KeyboardShortcutsModalProps) {
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose?.()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/50 px-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-shortcuts-heading"
        className="animate-popover-enter w-full max-w-[500px] overflow-hidden rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-surface-card)] text-[var(--color-ink)] shadow-[var(--shadow-float)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-line)] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <Keyboard size={18} className="text-[var(--color-ink-muted)]" />
            <h2
              id="keyboard-shortcuts-heading"
              className="text-[15.5px] font-semibold tracking-tight text-[var(--color-ink)]"
            >
              Keyboard Shortcuts
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shortcuts"
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-ink)]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[64vh] space-y-5 overflow-y-auto px-5 py-4">
          {SHORTCUT_SECTIONS.map((section) => (
            <div key={section.category}>
              <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-[var(--color-ink-faint)] uppercase">
                {section.category}
              </h3>
              <div className="divide-y divide-[var(--color-line)] rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-low)] px-3.5">
                {section.items.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between gap-3 py-2 text-[13px]"
                  >
                    <span className="text-[var(--color-ink)]">{item.label}</span>
                    <div className="flex items-center gap-1">
                      {item.keys.map((k, kIdx) => (
                        <Kbd key={kIdx}>{k}</Kbd>
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
  )
}
