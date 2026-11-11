import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { Check, ChevronDown, HelpCircle, Sparkles } from 'lucide-react'

/* ═══════════════════════════════════════════════════════════════════════════
   1. HARDWARE TACTILE BUTTONS & KEYCAPS (0.97 RECESSED PRESS)
   ═══════════════════════════════════════════════════════════════════════════ */

export type ButtonVariant = 'primary' | 'neutral' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'xs' | 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--color-accent-fill)] hover:bg-[var(--color-accent-fill-hover)] text-[var(--color-accent-ink)] font-semibold border border-transparent shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_1px_2px_rgba(0,0,0,0.28)]',
  neutral:
    'bg-[var(--color-ink)] text-[var(--color-surface)] hover:opacity-92 font-semibold border border-transparent shadow-[0_1px_2px_rgba(0,0,0,0.22)]',
  secondary:
    'bg-[var(--color-surface-elevated)] hover:bg-[var(--color-surface-hover)] text-[var(--color-ink)] border border-[var(--color-line-strong)] shadow-[var(--shadow-hairline)]',
  ghost:
    'bg-transparent hover:bg-[var(--color-surface-hover)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] border border-transparent',
  danger:
    'bg-[var(--color-diff-del-bg)] hover:opacity-90 text-[var(--color-err)] border border-[var(--color-err)]/30',
}

const BUTTON_SIZES: Record<ButtonSize, string> = {
  xs: 'h-7 px-2.5 text-[12px] rounded-md gap-1.5',
  sm: 'h-8 px-3 text-[13px] rounded-lg gap-1.5',
  md: 'h-9 px-3.5 text-[13.5px] rounded-lg gap-2',
}

export function Button({
  variant = 'secondary',
  size = 'sm',
  className = '',
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex shrink-0 cursor-pointer items-center justify-center font-medium whitespace-nowrap select-none transition-[transform,background-color,color,border-color,opacity] duration-120 ease-[var(--ease-out-expo)] active:translate-y-[0.5px] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Kbd({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={`inline-flex h-[19px] min-w-[19px] shrink-0 items-center justify-center rounded border border-[var(--color-line-strong)] bg-[var(--color-surface-low)] px-1.5 font-mono text-[10.5px] leading-none font-medium text-[var(--color-ink-faint)] shadow-[inset_0_-1px_0_rgba(0,0,0,0.22)] ${className}`}
    >
      {children}
    </kbd>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. BRIEF '?' HELP HINT POPOVER (MILLER'S LAW + WCAG 1.4.13)
   ═══════════════════════════════════════════════════════════════════════════ */

export function HelpHint({
  text,
  align = 'center',
}: {
  text: string
  align?: 'left' | 'center' | 'right'
}) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [pinned, setPinned] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const tooltipId = useId()

  const open = hovered || focused || pinned

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setHovered(false)
        setFocused(false)
        setPinned(false)
      }
    }
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setPinned(false)
        setHovered(false)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  const posClass =
    align === 'right'
      ? 'right-0'
      : align === 'left'
        ? 'left-0'
        : 'left-1/2 -translate-x-1/2'

  return (
    <span
      ref={wrapRef}
      className="relative inline-flex items-center"
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') setHovered(true)
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') setHovered(false)
      }}
    >
      <button
        type="button"
        aria-label="What is this?"
        aria-describedby={open ? tooltipId : undefined}
        onClick={(e) => {
          e.stopPropagation()
          setPinned((p) => !p)
          setHovered(false)
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
      >
        <HelpCircle size={13} />
      </button>
      {open && (
        <span
          id={tooltipId}
          role="tooltip"
          className={`animate-popover-enter absolute top-[calc(100%+6px)] z-50 w-56 rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-surface-elevated)] px-3 py-2 text-left font-sans text-[12px] leading-snug font-normal whitespace-normal text-[var(--color-ink)] shadow-[var(--shadow-float)] ${posClass}`}
        >
          {text}
        </span>
      )}
    </span>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. MONOCHROME SPRING-PILL SEGMENTED CONTROL (<190ms)
   ═══════════════════════════════════════════════════════════════════════════ */

export interface SegmentedItem<T extends string> {
  value: T
  label: string
  icon?: ReactNode
  badge?: string | number
  testId?: string
}

export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  size = 'sm',
  ariaLabel,
  roleType = 'tablist',
  fullWidth = false,
  className = '',
}: {
  items: ReadonlyArray<SegmentedItem<T>>
  value: T
  onChange: (next: T) => void
  size?: 'xs' | 'sm'
  ariaLabel?: string
  roleType?: 'tablist' | 'group'
  fullWidth?: boolean
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null)

  const activeIdx = Math.max(
    0,
    items.findIndex((i) => i.value === value),
  )

  useLayoutEffect(() => {
    const update = () => {
      const btn = btnRefs.current[activeIdx]
      const root = containerRef.current
      if (!btn || !root) return
      setPill({ left: btn.offsetLeft, width: btn.offsetWidth })
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(update)
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [activeIdx, items.length])

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const dir = e.key === 'ArrowRight' ? 1 : -1
    const nextIdx = (activeIdx + dir + items.length) % items.length
    onChange(items[nextIdx].value)
    btnRefs.current[nextIdx]?.focus()
  }

  const pad = size === 'xs' ? 'px-2.5 py-1 text-[12px]' : 'px-3 py-1.5 text-[13px]'
  const hasSlidingPill = Boolean(pill && pill.width > 0)

  return (
    <div
      ref={containerRef}
      role={roleType}
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={`relative inline-flex items-center rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-low)] p-0.5 select-none ${fullWidth ? 'flex w-full' : ''} ${className}`}
    >
      {hasSlidingPill && pill && (
        <span
          aria-hidden="true"
          style={{
            transform: `translate3d(${pill.left}px, 0, 0)`,
            width: `${pill.width}px`,
            transition: 'transform 190ms var(--ease-spring), width 190ms var(--ease-spring)',
          }}
          className="pointer-events-none absolute inset-y-0.5 left-0 rounded-[6px] border border-[var(--color-line-strong)] bg-[var(--color-surface-elevated)] shadow-[var(--shadow-hairline)]"
        />
      )}
      {items.map((item, idx) => {
        const active = item.value === value
        return (
          <button
            key={item.value}
            ref={(el) => {
              btnRefs.current[idx] = el
            }}
            data-testid={item.testId}
            role={roleType === 'tablist' ? 'tab' : undefined}
            type="button"
            aria-selected={roleType === 'tablist' ? active : undefined}
            aria-pressed={roleType === 'group' ? active : undefined}
            tabIndex={roleType === 'tablist' ? (active ? 0 : -1) : 0}
            onClick={() => onChange(item.value)}
            className={`relative z-10 inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-[6px] font-medium whitespace-nowrap transition-colors duration-120 ${pad} ${fullWidth ? 'flex-1' : ''} ${
              active
                ? `${hasSlidingPill ? '' : 'bg-[var(--color-surface-elevated)]/80 '}text-[var(--color-ink)]`
                : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.badge !== undefined && (
              <span className="rounded bg-[var(--color-surface)] px-1.5 py-0.2 font-mono text-[10.5px] text-[var(--color-ink-muted)] tabular-nums">
                {item.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. FLOATING SELECT POPOVER (ZERO NATIVE <select>)
   ═══════════════════════════════════════════════════════════════════════════ */

export interface SelectOption<T extends string> {
  value: T
  label: string
  description?: string
  meta?: string
  icon?: ReactNode
}

export function SelectPopover<T extends string>({
  options,
  value,
  onChange,
  prefix,
  align = 'left',
  side = 'bottom',
  size = 'sm',
  ariaLabel,
  title,
  triggerId,
  className = '',
  menuWidthClass = 'w-64',
}: {
  options: ReadonlyArray<SelectOption<T>>
  value: T
  onChange: (next: T) => void
  prefix?: ReactNode
  align?: 'left' | 'right'
  side?: 'bottom' | 'top'
  size?: 'xs' | 'sm'
  ariaLabel?: string
  title?: string
  triggerId?: string
  className?: string
  menuWidthClass?: string
}) {
  const [open, setOpen] = useState(false)
  const [focusIdx, setFocusIdx] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listboxId = useId()

  const current = options.find((o) => o.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    const onDocPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onDocPointer)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('pointerdown', onDocPointer)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const toggleOpen = () => {
    if (options.length === 0) return
    const idx = Math.max(
      0,
      options.findIndex((o) => o.value === value),
    )
    setFocusIdx(idx)
    setOpen((o) => !o)
  }

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (options.length === 0) return
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        toggleOpen()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusIdx((i) => (i + 1) % options.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusIdx((i) => (i - 1 + options.length) % options.length)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const picked = options[focusIdx]
      if (picked) onChange(picked.value)
      setOpen(false)
      triggerRef.current?.focus()
    }
  }

  const triggerSize =
    size === 'xs'
      ? 'h-7 px-2.5 text-[12px] rounded-md gap-1.5'
      : 'h-8 px-3 text-[13px] rounded-lg gap-2'

  const menuPos =
    side === 'top'
      ? `bottom-[calc(100%+6px)] ${align === 'right' ? 'right-0' : 'left-0'}`
      : `top-[calc(100%+6px)] ${align === 'right' ? 'right-0' : 'left-0'}`

  return (
    <div ref={wrapRef} onKeyDown={handleKeyDown} className={`relative inline-block ${className}`}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        title={title ?? ariaLabel}
        onClick={toggleOpen}
        className={`inline-flex w-full cursor-pointer items-center justify-between border border-[var(--color-line-strong)] bg-[var(--color-surface-elevated)] font-medium whitespace-nowrap text-[var(--color-ink)] shadow-[var(--shadow-hairline)] transition-colors hover:bg-[var(--color-surface-hover)] active:scale-[0.98] ${triggerSize}`}
      >
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          {prefix ?? current?.icon}
          <span className="truncate">{current?.label}</span>
        </span>
        <ChevronDown
          size={13}
          className={`shrink-0 text-[var(--color-ink-faint)] transition-transform duration-150 ${
            open ? 'rotate-180 text-[var(--color-ink)]' : ''
          }`}
        />
      </button>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          className={`animate-popover-enter absolute z-50 max-h-72 overflow-y-auto ${menuPos} ${menuWidthClass} rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface-card)] p-1 shadow-[var(--shadow-float)]`}
        >
          {options.map((opt, idx) => {
            const selected = opt.value === value
            const focused = idx === focusIdx
            return (
              <button
                key={opt.value}
                role="option"
                type="button"
                aria-selected={selected}
                onMouseEnter={() => setFocusIdx(idx)}
                onClick={() => {
                  onChange(opt.value)
                  setOpen(false)
                  triggerRef.current?.focus()
                }}
                className={`flex w-full cursor-pointer items-start justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
                  focused ? 'bg-[var(--color-surface-hover)]' : ''
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--color-ink)]">
                    {opt.icon && <span className="shrink-0 text-[var(--color-ink-muted)]">{opt.icon}</span>}
                    <span className="truncate">{opt.label}</span>
                    {opt.meta && (
                      <span className="font-mono text-[10.5px] text-[var(--color-ink-faint)]">
                        {opt.meta}
                      </span>
                    )}
                  </span>
                  {opt.description && (
                    <span className="mt-0.5 block text-[11.5px] leading-snug text-[var(--color-ink-muted)]">
                      {opt.description}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-[var(--color-brand)]">
                  {selected && <Check size={13} strokeWidth={2.4} />}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. FLUID ACCORDION, STAGE TRANSITION & NON-BLOCKING TOAST STACK
   ═══════════════════════════════════════════════════════════════════════════ */

export function FluidAccordion({
  open,
  children,
  className = '',
}: {
  open: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <div data-open={open} className={`accordion-grid ${className}`}>
      <div className="accordion-inner">{children}</div>
    </div>
  )
}

export function StageTransition({
  stageKey,
  children,
  className = '',
}: {
  stageKey: string | number
  children: ReactNode
  className?: string
}) {
  return (
    <div key={stageKey} className={`animate-stage-enter ${className}`}>
      {children}
    </div>
  )
}

export interface ToastMessage {
  id: string
  title: string
  detail?: string
  icon?: ReactNode
  action?: { label: string; onClick: () => void }
}

export function ToastStack({
  toasts,
  onDismiss,
  id,
}: {
  toasts: ToastMessage[]
  onDismiss: (id: string) => void
  id?: string
}) {
  if (toasts.length === 0) return null
  return (
    <div
      id={id}
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-[600] flex flex-col gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => onDismiss(t.id)}
          className="animate-popover-enter pointer-events-auto flex max-w-sm cursor-pointer items-center gap-2.5 rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface-elevated)] px-3.5 py-2.5 text-[13px] shadow-[var(--shadow-float)]"
        >
          {t.icon ?? <Sparkles size={13} className="shrink-0 text-[var(--color-brand)]" />}
          <div className="min-w-0 flex-1">
            <div className="font-medium text-[var(--color-ink)]">{t.title}</div>
            {t.detail && (
              <div className="truncate text-[11.5px] text-[var(--color-ink-muted)]">{t.detail}</div>
            )}
          </div>
          {t.action && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                t.action?.onClick()
                onDismiss(t.id)
              }}
              className="shrink-0 cursor-pointer rounded-md border border-[var(--color-line-strong)] bg-[var(--color-surface-card)] px-2 py-1 text-[11.5px] font-semibold text-[var(--color-brand)] transition-colors hover:bg-[var(--color-surface-hover)]"
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
