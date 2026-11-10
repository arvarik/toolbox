import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import {
  Bookmark,
  Check,
  ChevronDown,
  HelpCircle,
  Lock,
  MessageSquare,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  X,
} from 'lucide-react'
import type { HighlightColor } from '../../utils/api'
import { DomainGlyph } from './DomainGlyph'
import { KitAvatar, KitLogo } from './KitLogo'

export interface TextbookHighlight {
  id: string
  pageId?: string
  quote: string
  color: HighlightColor
  note?: string
  cardId?: string | null
}

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
   2. BRIEF '?' HELP HINT POPOVER (MILLER'S LAW: <= 14 WORDS)
   ═══════════════════════════════════════════════════════════════════════════ */

export function HelpHint({
  text,
  align = 'center',
}: {
  text: string
  align?: 'left' | 'center' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const posClass =
    align === 'right'
      ? 'right-0'
      : align === 'left'
        ? 'left-0'
        : 'left-1/2 -translate-x-1/2'

  return (
    <span
      className="relative inline-flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="What is this?"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
      >
        <HelpCircle size={13} />
      </button>
      {open && (
        <span
          role="tooltip"
          className={`animate-popover-enter pointer-events-none absolute top-[calc(100%+6px)] z-50 w-56 rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-surface-elevated)] px-3 py-2 text-left font-sans text-[12px] leading-snug font-normal whitespace-normal text-[var(--color-ink)] shadow-[var(--shadow-float)] ${posClass}`}
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

  return (
    <div
      ref={containerRef}
      role={roleType}
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={`relative inline-flex items-center rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-low)] p-0.5 select-none ${fullWidth ? 'flex w-full' : ''} ${className}`}
    >
      {pill && pill.width > 0 && (
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
                ? 'bg-[var(--color-surface-elevated)]/80 text-[var(--color-ink)]'
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
  triggerId?: string
  className?: string
  menuWidthClass?: string
}) {
  const [open, setOpen] = useState(false)
  const [focusIdx, setFocusIdx] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()

  const current = options.find((o) => o.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    const onDocPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDocPointer)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('pointerdown', onDocPointer)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const toggleOpen = () => {
    const idx = Math.max(
      0,
      options.findIndex((o) => o.value === value),
    )
    setFocusIdx(idx)
    setOpen((o) => !o)
  }

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
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
        id={triggerId}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        onClick={toggleOpen}
        className={`inline-flex w-full cursor-pointer items-center justify-between border border-[var(--color-line-strong)] bg-[var(--color-surface-elevated)] font-medium whitespace-nowrap text-[var(--color-ink)] shadow-[var(--shadow-hairline)] transition-colors hover:bg-[var(--color-surface-hover)] active:scale-[0.98] ${triggerSize}`}
      >
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          {prefix}
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
                }}
                className={`flex w-full cursor-pointer items-start justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
                  focused ? 'bg-[var(--color-surface-hover)]' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--color-ink)]">
                    <span className="truncate">{opt.label}</span>
                    {opt.meta && (
                      <span className="font-mono text-[10.5px] text-[var(--color-ink-faint)]">
                        {opt.meta}
                      </span>
                    )}
                  </div>
                  {opt.description && (
                    <div className="mt-0.5 text-[11.5px] leading-snug text-[var(--color-ink-muted)]">
                      {opt.description}
                    </div>
                  )}
                </div>
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
   5. ELASTIC HARDWARE SCRUBBER (MAGNETIC DETENTS + EDGE RUBBER-BANDING)
   ═══════════════════════════════════════════════════════════════════════════ */

export function ScrubberSlider({
  label,
  value,
  min,
  max,
  step = 1,
  formatValue,
  ticks,
  onChange,
  className = '',
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  formatValue?: (val: number) => string
  ticks?: number[]
  onChange: (next: number) => void
  className?: string
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [stretchPx, setStretchPx] = useState(0)

  const clampSnap = (raw: number, fine: boolean) => {
    if (!fine && ticks?.length) {
      const snapZone = (max - min) * 0.018
      for (const t of ticks) {
        if (Math.abs(raw - t) <= snapZone) return t
      }
    }
    const s = fine ? step * 0.2 : step
    const snapped = Math.round((raw - min) / s) * s + min
    return Number(Math.min(max, Math.max(min, snapped)).toFixed(4))
  }

  const updateFromPointer = (clientX: number, fine: boolean) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    const rawRatio = (clientX - rect.left) / rect.width
    if (rawRatio < 0) {
      setStretchPx(Math.max(-3, rawRatio * 10))
    } else if (rawRatio > 1) {
      setStretchPx(Math.min(3, (rawRatio - 1) * 10))
    } else {
      setStretchPx(0)
    }
    const ratio = Math.min(1, Math.max(0, rawRatio))
    onChange(clampSnap(min + ratio * (max - min), fine))
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setDragging(true)
    updateFromPointer(e.clientX, e.shiftKey)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    updateFromPointer(e.clientX, e.shiftKey)
  }

  const release = () => {
    setDragging(false)
    setStretchPx(0)
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const dir = e.key === 'ArrowRight' ? 1 : -1
    const delta = (e.shiftKey ? step * 0.2 : step) * dir
    onChange(clampSnap(value + delta, e.shiftKey))
  }

  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))

  return (
    <div className={`select-none ${className}`}>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-[13px]">
        <span className="text-[var(--color-ink-muted)]">{label}</span>
        <span className="shrink-0 font-mono font-semibold whitespace-nowrap text-[var(--color-ink)] tabular-nums">
          {formatValue ? formatValue(value) : value}
        </span>
      </div>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={release}
        onPointerCancel={release}
        style={{
          transform: `translate3d(${stretchPx}px, 0, 0)`,
          transition: dragging ? 'none' : 'transform 180ms var(--ease-spring)',
        }}
        className="group relative flex h-6 cursor-ew-resize touch-none items-center"
      >
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-low)] ring-1 ring-[var(--color-line-strong)] inset-ring">
          <div
            style={{ width: `${pct}%` }}
            className="h-full rounded-full bg-[var(--color-ink)] transition-[width] duration-75"
          />
        </div>

        {ticks?.map((t) => {
          const tPct = ((t - min) / (max - min)) * 100
          return (
            <span
              key={t}
              style={{ left: `${tPct}%` }}
              className="pointer-events-none absolute top-1/2 h-2 w-px -translate-x-1/2 -translate-y-1/2 bg-[var(--color-line-strong)]"
            />
          )
        })}

        <span
          style={{ left: `${pct}%` }}
          className={`pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-surface-card)] shadow transition-transform duration-150 ease-[var(--ease-spring)] ${
            dragging ? 'scale-125 border-[var(--color-brand)]' : 'group-hover:scale-110'
          }`}
        />
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. FLUID ACCORDION & STAGE TRANSITION
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

/* ═══════════════════════════════════════════════════════════════════════════
   7. MONOCHROME-UNTIL-OVERDUE MEMORY RING & MAGNETIC CURVE GRAPH
   ═══════════════════════════════════════════════════════════════════════════ */

export function RetrievabilityRing({
  retrievability,
  locked = false,
  size = 16,
  showLabel = false,
}: {
  retrievability: number
  locked?: boolean
  size?: number
  showLabel?: boolean
}) {
  if (locked) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[11.5px] text-[var(--color-ink-faint)]">
        <Lock size={size - 3} />
        {showLabel && <span>Locked</span>}
      </span>
    )
  }

  const r = Math.max(0, Math.min(100, retrievability))
  const strokeWidth = 2
  const radius = (size - strokeWidth) / 2
  const circ = 2 * Math.PI * radius
  const offset = circ * (1 - r / 100)

  const overdue = r < 70
  const strokeColor = overdue ? 'var(--color-err)' : 'var(--color-ink-muted)'
  const textClass = overdue
    ? 'text-[var(--color-err)] font-medium'
    : 'text-[var(--color-ink-muted)]'

  return (
    <span className="inline-flex items-center gap-1.5 tabular-nums">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-line-strong)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      {showLabel && <span className={`font-mono text-[12px] ${textClass}`}>{r}%</span>}
    </span>
  )
}

export function ForgettingCurve({
  stabilityDays,
  projectedStabilityDays,
  horizonDays = 60,
  className = '',
}: {
  stabilityDays: number
  projectedStabilityDays?: number | null
  horizonDays?: number
  className?: string
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoverDay, setHoverDay] = useState<number | null>(null)

  const w = 320
  const h = 112
  const padL = 32
  const padR = 12
  const padT = 12
  const padB = 22
  const plotW = w - padL - padR
  const plotH = h - padT - padB

  const rAt = (t: number, s: number) => Math.pow(1 + (19 / 81) * (t / Math.max(0.5, s)), -0.5)
  const xOf = (t: number) => padL + (t / horizonDays) * plotW
  const yOf = (r: number) => padT + (1 - (r - 0.5) / 0.5) * plotH

  const buildPath = (s: number) => {
    const pts: string[] = []
    for (let i = 0; i <= 40; i++) {
      const t = (i / 40) * horizonDays
      const r = Math.max(0.5, rAt(t, s))
      pts.push(`${i === 0 ? 'M' : 'L'}${xOf(t).toFixed(1)},${yOf(r).toFixed(1)}`)
    }
    return pts.join(' ')
  }

  const onMouseMove = (e: ReactMouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    const relX = ((e.clientX - rect.left) / rect.width) * w
    const day = Math.round(
      Math.min(horizonDays, Math.max(0, ((relX - padL) / plotW) * horizonDays)),
    )
    setHoverDay(day)
  }

  const activeDay = hoverDay ?? 14
  const activeS = projectedStabilityDays ?? stabilityDays
  const activeR = Math.max(0.5, rAt(activeDay, activeS))
  const cx = xOf(activeDay)
  const cy = yOf(activeR)

  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center justify-between text-[12px] text-[var(--color-ink-muted)] tabular-nums">
        <span>Hover curve to inspect memory</span>
        <span className="font-mono text-[var(--color-ink)]">
          Day {activeDay} · {Math.round(activeR * 100)}%
        </span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${w} ${h}`}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHoverDay(null)}
        className="w-full cursor-crosshair overflow-visible select-none"
      >
        <line
          x1={padL}
          y1={padT + plotH}
          x2={w - padR}
          y2={padT + plotH}
          stroke="var(--color-line-strong)"
        />
        <line
          x1={padL}
          y1={yOf(0.9)}
          x2={w - padR}
          y2={yOf(0.9)}
          stroke="var(--color-line)"
          strokeDasharray="3 3"
        />
        <text
          x={padL - 5}
          y={padT + 4}
          textAnchor="end"
          className="fill-[var(--color-ink-faint)] font-mono text-[8.5px]"
        >
          100%
        </text>
        <text
          x={padL - 5}
          y={padT + plotH}
          textAnchor="end"
          className="fill-[var(--color-ink-faint)] font-mono text-[8.5px]"
        >
          50%
        </text>

        <path
          d={buildPath(stabilityDays)}
          fill="none"
          stroke="var(--color-ink-muted)"
          strokeWidth="1.8"
          strokeLinecap="round"
        />

        {projectedStabilityDays && projectedStabilityDays > stabilityDays && (
          <path
            d={buildPath(projectedStabilityDays)}
            fill="none"
            stroke="var(--color-ok)"
            strokeWidth="2"
            strokeDasharray="4 3"
            strokeLinecap="round"
          />
        )}

        <line
          x1={cx}
          y1={padT}
          x2={cx}
          y2={padT + plotH}
          stroke="var(--color-line-strong)"
          strokeWidth="1"
        />
        <circle
          cx={cx}
          cy={cy}
          r={hoverDay !== null ? 4.2 : 3}
          fill="var(--color-brand)"
          className="transition-[r] duration-100"
        />

        <text x={padL} y={h - 4} className="fill-[var(--color-ink-faint)] font-mono text-[8.5px]">
          Today
        </text>
        <text
          x={w - padR}
          y={h - 4}
          textAnchor="end"
          className="fill-[var(--color-ink-faint)] font-mono text-[8.5px]"
        >
          +{horizonDays}d
        </text>
      </svg>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   8. NOTEBOOK SHEET & INTERACTIVE TOP-RIGHT DOGEAR CORNER (ZEIGARNIK EFFECT)
   ═══════════════════════════════════════════════════════════════════════════ */

export function DogearCorner({
  folded,
  onToggle,
  testId,
}: {
  folded: boolean
  onToggle: () => void
  testId?: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onToggle}
      title={folded ? 'Remove dogear' : 'Dogear this page to revisit later'}
      aria-label={folded ? 'Remove page dogear' : 'Dogear this page'}
      aria-pressed={folded}
      className="group absolute top-0 right-0 z-20 h-9 w-9 cursor-pointer overflow-hidden rounded-tr-xl focus-visible:outline-offset-[-2px]"
    >
      <span
        style={{
          width: folded ? 26 : 12,
          height: folded ? 26 : 12,
          transition: 'width 180ms var(--ease-spring), height 180ms var(--ease-spring)',
        }}
        className={`pointer-events-none absolute top-0 right-0 block rounded-bl-md border-b border-l ${
          folded
            ? 'border-[var(--color-brand)]/50 bg-[var(--color-surface-elevated)] shadow-[-3px_3px_6px_rgba(0,0,0,0.25)]'
            : 'border-[var(--color-line-strong)] bg-[var(--color-surface-elevated)] opacity-55 group-hover:!h-[18px] group-hover:!w-[18px] group-hover:opacity-100'
        }`}
      />
      {folded && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-[var(--color-brand)]"
        />
      )}
    </button>
  )
}

export function NotebookSheet({
  id,
  pageKey,
  direction = 'next',
  dogeared,
  onToggleDogear,
  dogearTestId,
  children,
  className = '',
}: {
  id?: string
  pageKey?: string
  direction?: 'next' | 'prev'
  dogeared?: boolean
  onToggleDogear?: () => void
  dogearTestId?: string
  children: ReactNode
  className?: string
}) {
  const animClass = pageKey
    ? direction === 'prev'
      ? 'animate-sheet-prev'
      : 'animate-sheet-next'
    : ''

  return (
    <article
      id={id}
      key={pageKey}
      className={`notebook-sheet relative rounded-xl ${animClass} ${className}`}
    >
      {onToggleDogear !== undefined && (
        <DogearCorner folded={Boolean(dogeared)} onToggle={onToggleDogear} testId={dogearTestId} />
      )}
      {children}
    </article>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   9. ORGANIC 3-INK TEXTBOOK HIGHLIGHTER & SELECTION TOOLBAR
   ═══════════════════════════════════════════════════════════════════════════ */

const INK_SWATCHES: Array<{ color: HighlightColor; label: string; dotBg: string }> = [
  { color: 'amber', label: 'Key idea (Amber)', dotBg: '#f0a429' },
  { color: 'sage', label: 'Formula / Example (Sage)', dotBg: '#6fbf94' },
  { color: 'coral', label: 'Question / Revisit (Coral)', dotBg: '#f08c82' },
]

function applyHighlightsToDom(
  root: HTMLElement,
  highlights: TextbookHighlight[],
  onRemove?: (id: string) => void,
) {
  // Unwrap previously injected marks cleanly before re-applying
  const existing = root.querySelectorAll('mark[data-hl-id]')
  existing.forEach((mark) => {
    const parent = mark.parentNode
    if (!parent) return
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
  })
  root.normalize()

  if (highlights.length === 0) return

  for (const h of highlights) {
    if (!h.quote || h.quote.length < 3) continue
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const el = node.parentElement
        if (!el) return NodeFilter.FILTER_REJECT
        if (el.closest('mark[data-hl-id], pre, code, .katex, svg, button')) {
          return NodeFilter.FILTER_REJECT
        }
        return node.nodeValue?.includes(h.quote)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP
      },
    })
    const textNode = walker.nextNode() as Text | null
    if (!textNode || !textNode.nodeValue) continue
    const idx = textNode.nodeValue.indexOf(h.quote)
    if (idx < 0) continue

    const target = textNode.splitText(idx)
    target.splitText(h.quote.length)
    const mark = document.createElement('mark')
    mark.setAttribute('data-hl-id', h.id)
    mark.className = `hl-mark hl-${h.color} text-[var(--color-ink)]`
    mark.title = h.note ? `${h.note} (click to remove)` : 'Click to remove highlight'
    if (onRemove) {
      mark.addEventListener('click', (ev) => {
        ev.stopPropagation()
        onRemove(h.id)
      })
    }
    target.parentNode?.insertBefore(mark, target)
    mark.appendChild(target)
  }
}

export function HighlightableProse({
  paragraphs,
  children,
  contentKey,
  highlights,
  onAddHighlight,
  onRemoveHighlight,
  onAskKit,
  onMakeCard,
  className = '',
}: {
  paragraphs?: string[]
  children?: ReactNode
  contentKey?: string
  highlights: TextbookHighlight[]
  onAddHighlight: (quote: string, color: HighlightColor, prefix?: string, suffix?: string) => void
  onRemoveHighlight?: (id: string) => void
  onAskKit?: (quote: string) => void
  onMakeCard?: (quote: string) => void
  className?: string
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const richContentRef = useRef<HTMLDivElement>(null)
  const [selection, setSelection] = useState<{
    text: string
    prefix: string
    suffix: string
    x: number
    y: number
  } | null>(null)

  useEffect(() => {
    if (!children || !richContentRef.current) return
    applyHighlightsToDom(richContentRef.current, highlights, onRemoveHighlight)
  }, [children, contentKey, highlights, onRemoveHighlight])

  const checkSelection = () => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) {
      setSelection(null)
      return
    }
    const text = sel.toString().trim()
    if (text.length < 4 || !wrapRef.current) {
      setSelection(null)
      return
    }
    const range = sel.getRangeAt(0)
    if (!wrapRef.current.contains(range.commonAncestorContainer)) {
      setSelection(null)
      return
    }
    const rect = range.getBoundingClientRect()
    const host = wrapRef.current.getBoundingClientRect()
    const fullText = wrapRef.current.textContent ?? ''
    const pos = fullText.indexOf(text)
    const prefix = pos > 0 ? fullText.slice(Math.max(0, pos - 48), pos) : ''
    const suffix = pos >= 0 ? fullText.slice(pos + text.length, pos + text.length + 48) : ''

    setSelection({
      text,
      prefix,
      suffix,
      x: Math.min(Math.max(96, rect.left - host.left + rect.width / 2), Math.max(96, host.width - 96)),
      y: Math.max(0, rect.top - host.top - 42),
    })
  }

  const renderHighlightedParagraph = (p: string) => {
    const matching = highlights.filter((h) => p.includes(h.quote))
    if (matching.length === 0) return p
    const first = matching[0]
    const idx = p.indexOf(first.quote)
    if (idx < 0) return p
    const before = p.slice(0, idx)
    const after = p.slice(idx + first.quote.length)

    return (
      <>
        {before}
        <mark
          title={first.note ? `${first.note} (click to remove)` : 'Click to remove highlight'}
          onClick={(e) => {
            e.stopPropagation()
            onRemoveHighlight?.(first.id)
          }}
          className={`hl-mark hl-${first.color} text-[var(--color-ink)]`}
        >
          {first.quote}
        </mark>
        {after}
      </>
    )
  }

  const commitHighlight = (color: HighlightColor) => {
    if (!selection) return
    onAddHighlight(selection.text, color, selection.prefix, selection.suffix)
    window.getSelection()?.removeAllRanges()
    setSelection(null)
  }

  return (
    <div
      ref={wrapRef}
      onMouseUp={checkSelection}
      className={`relative text-[15.5px] leading-[1.72] text-[var(--color-ink)] ${className}`}
    >
      {selection && (
        <div
          data-testid="highlight-selection-toolbar"
          style={{ left: `${selection.x}px`, top: `${selection.y}px` }}
          className="animate-popover-enter absolute z-30 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-surface-elevated)] px-2 py-1 text-[12px] shadow-[var(--shadow-float)]"
        >
          <button
            type="button"
            onClick={() => commitHighlight('amber')}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-hover)]"
          >
            <span className="h-2.5 w-2.5 rounded-full bg-[#f0a429]" />
            Highlight
          </button>
          {INK_SWATCHES.slice(1).map((sw) => (
            <button
              key={sw.color}
              type="button"
              title={sw.label}
              aria-label={sw.label}
              onClick={() => commitHighlight(sw.color)}
              className="flex h-6 w-5 cursor-pointer items-center justify-center rounded hover:bg-[var(--color-surface-hover)]"
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: sw.dotBg }} />
            </button>
          ))}
          {onMakeCard && (
            <>
              <span className="h-3.5 w-px bg-[var(--color-line-strong)]" />
              <button
                type="button"
                onClick={() => {
                  onMakeCard(selection.text)
                  window.getSelection()?.removeAllRanges()
                  setSelection(null)
                }}
                className="cursor-pointer rounded px-2 py-1 font-medium whitespace-nowrap text-[var(--color-ink)] hover:bg-[var(--color-surface-hover)]"
              >
                Make Card
              </button>
            </>
          )}
          {onAskKit && (
            <>
              <span className="h-3.5 w-px bg-[var(--color-line-strong)]" />
              <button
                type="button"
                onClick={() => {
                  onAskKit(selection.text)
                  window.getSelection()?.removeAllRanges()
                  setSelection(null)
                }}
                className="inline-flex cursor-pointer items-center gap-1 rounded px-2 py-1 font-medium whitespace-nowrap text-[var(--color-brand)] hover:bg-[var(--color-surface-hover)]"
              >
                <MessageSquare size={11} />
                Ask Kit
              </button>
            </>
          )}
        </div>
      )}

      {paragraphs ? (
        <div className="space-y-4">
          {paragraphs.map((p, i) => (
            <p key={i}>{renderHighlightedParagraph(p)}</p>
          ))}
        </div>
      ) : (
        <div ref={richContentRef}>{children}</div>
      )}

      {children && highlights.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-[var(--color-line)] pt-3">
          {highlights.map((h) => (
            <span
              key={h.id}
              className={`hl-${h.color} inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-0.5 text-[12px] text-[var(--color-ink)]`}
            >
              <span className="max-w-[240px] truncate">“{h.quote}”</span>
              {onAskKit && (
                <button
                  type="button"
                  title="Ask Kit about this highlight"
                  aria-label="Ask Kit about highlight"
                  onClick={() => onAskKit(h.quote)}
                  className="cursor-pointer text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                >
                  <MessageSquare size={11} />
                </button>
              )}
              {onRemoveHighlight && (
                <button
                  type="button"
                  title="Remove highlight"
                  aria-label="Remove highlight"
                  onClick={() => onRemoveHighlight(h.id)}
                  className="cursor-pointer text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                >
                  <X size={11} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   10. CLEAN RENDERED NOTE UPDATE CARD + OPTIONAL DIFF DISCLOSURE
   ═══════════════════════════════════════════════════════════════════════════ */

export function NoteUpdateCard({
  sectionName,
  summaryBullets,
  hunks,
  accepted,
  onToggleAccept,
}: {
  sectionName: string
  summaryBullets: string[]
  hunks: Array<{ type: 'ctx' | 'del' | 'add'; line: string }>
  accepted: boolean
  onToggleAccept: () => void
}) {
  const [showDiff, setShowDiff] = useState(false)

  return (
    <div className="border-b border-[var(--color-line)] py-4 first:pt-1 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="font-serif text-[15px] font-medium text-[var(--color-ink)]">
            {sectionName}
          </h4>
        </div>
        <Button size="xs" variant={accepted ? 'ghost' : 'secondary'} onClick={onToggleAccept}>
          {accepted ? (
            <>
              <Check size={12} className="text-[var(--color-ok)]" /> Selected
            </>
          ) : (
            'Include'
          )}
        </Button>
      </div>

      <ul className="mt-2 space-y-1.5 text-[13.5px] leading-snug text-[var(--color-ink-muted)]">
        {summaryBullets.map((b, idx) => (
          <li key={idx} className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--color-ink-faint)]" />
            <span>{b}</span>
          </li>
        ))}
      </ul>

      <div className="mt-2.5">
        <button
          type="button"
          onClick={() => setShowDiff((d) => !d)}
          className="cursor-pointer text-[12px] font-medium text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
        >
          {showDiff ? 'Hide exact changes' : 'Show diff'}
        </button>

        <FluidAccordion open={showDiff}>
          <div className="mt-2 overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-low)] text-[12px]">
            {hunks.map((h, i) => {
              const rowClass =
                h.type === 'add'
                  ? 'border-l-2 border-[var(--color-diff-add-bar)] bg-[var(--color-diff-add-bg)] text-[var(--color-diff-add-ink)]'
                  : h.type === 'del'
                    ? 'border-l-2 border-[var(--color-diff-del-bar)] bg-[var(--color-diff-del-bg)] text-[var(--color-diff-del-ink)] line-through opacity-85'
                    : 'border-l-2 border-transparent text-[var(--color-ink-muted)]'
              return (
                <div key={i} className={`flex gap-2 px-3 py-1.5 leading-snug ${rowClass}`}>
                  <span className="w-3 shrink-0 font-mono select-none">
                    {h.type === 'add' ? '+' : h.type === 'del' ? '−' : ' '}
                  </span>
                  <span>{h.line}</span>
                </div>
              )
            })}
          </div>
        </FluidAccordion>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   11. PURE ANKI CARD STACK (ZERO CONFIDENCE GATE · GOAL-GRADIENT + PEAK-END)
   ═══════════════════════════════════════════════════════════════════════════ */

export type AnkiGrade = 'again' | 'hard' | 'good' | 'easy'

export function AnkiCardStack({
  front,
  back,
  frontSlot,
  backSlot,
  topicLabel,
  intervals,
  remainingCount,
  boostedFoundations,
  onRate,
  onReset,
}: {
  front: string
  back: string
  frontSlot?: ReactNode
  backSlot?: ReactNode
  topicLabel: string
  intervals: { again: string; hard: string; good: string; easy: string }
  remainingCount: number
  boostedFoundations?: string[]
  onRate: (grade: AnkiGrade) => void
  onReset?: () => void
}) {
  const [flipped, setFlipped] = useState(false)
  const [typeMode, setTypeMode] = useState(false)
  const [typedDraft, setTypedDraft] = useState('')

  useEffect(() => {
    setFlipped(false)
    setTypedDraft('')
  }, [front, remainingCount])

  useEffect(() => {
    if (remainingCount <= 0) return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (!flipped && e.code === 'Space') {
        e.preventDefault()
        setFlipped(true)
      } else if (flipped) {
        if (e.key === '1') onRate('again')
        else if (e.key === '2') onRate('hard')
        else if (e.key === '3') onRate('good')
        else if (e.key === '4') onRate('easy')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flipped, onRate, remainingCount])

  if (remainingCount <= 0) {
    return (
      <div className="notebook-sheet animate-stage-enter mx-auto max-w-xl rounded-2xl p-8 text-center">
        <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface-elevated)]">
          <KitLogo size={30} state="done" />
        </div>
        <h3 className="font-serif text-xl text-[var(--color-ink)]">All caught up for today</h3>
        <p className="mt-1.5 text-[14px] text-[var(--color-ink-muted)]">
          Steady, spaced practice makes memory stick.
        </p>
        {onReset && (
          <div className="mt-5">
            <Button variant="secondary" size="sm" onClick={onReset}>
              <RotateCcw size={13} /> Replay sample cards
            </Button>
          </div>
        )}
      </div>
    )
  }

  const stackLayers = Math.min(3, Math.max(0, remainingCount - 1))

  const gradeButtons: Array<{ id: AnkiGrade; label: string; key: string; time: string }> = [
    { id: 'again', label: 'Again', key: '1', time: intervals.again },
    { id: 'hard', label: 'Hard', key: '2', time: intervals.hard },
    { id: 'good', label: 'Good', key: '3', time: intervals.good },
    { id: 'easy', label: 'Easy', key: '4', time: intervals.easy },
  ]

  return (
    <div className="relative mx-auto w-full max-w-2xl pb-4">
      {Array.from({ length: stackLayers }).map((_, i) => {
        const depth = stackLayers - i
        return (
          <div
            key={depth}
            aria-hidden="true"
            style={{
              transform: `translate3d(0, ${depth * 6}px, 0) scale(${1 - depth * 0.018})`,
            }}
            className="pointer-events-none absolute inset-x-0 bottom-4 h-16 rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-surface-card)] opacity-65 transition-transform duration-200"
          />
        )
      })}

      <div className="notebook-sheet relative z-10 rounded-2xl p-6 sm:p-8">
        <div className="mb-5 flex items-center justify-between text-[12.5px] text-[var(--color-ink-muted)]">
          <span>{topicLabel}</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setTypeMode((t) => !t)}
              className={`cursor-pointer transition-colors ${
                typeMode
                  ? 'font-medium text-[var(--color-brand)]'
                  : 'text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]'
              }`}
            >
              {typeMode ? 'Typing on' : 'Type answer'}
            </button>
            <span className="font-mono text-[11.5px] text-[var(--color-ink-faint)] tabular-nums">
              {remainingCount} left
            </span>
          </div>
        </div>

        <div data-testid="anki-card-front">
          {frontSlot ?? (
            <h3 className="font-serif text-[21px] leading-[1.42] font-normal text-[var(--color-ink)]">
              {front}
            </h3>
          )}
        </div>

        {typeMode && !flipped && (
          <div className="mt-5">
            <input
              type="text"
              value={typedDraft}
              onChange={(e) => setTypedDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setFlipped(true)
              }}
              placeholder="Jot a quick 1-line answer, then press Enter..."
              className="w-full rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface-low)] px-4 py-3 text-[14.5px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-brand)] focus:outline-none"
            />
          </div>
        )}

        {!flipped ? (
          <div className="mt-8 flex items-center justify-center border-t border-[var(--color-line)] pt-6">
            <Button
              variant="primary"
              size="md"
              onClick={() => setFlipped(true)}
              className="min-w-44"
            >
              Reveal Answer{' '}
              <span className="ml-1 rounded border border-current/25 px-1.5 py-0.5 font-mono text-[10.5px]">
                Space
              </span>
            </Button>
          </div>
        ) : (
          <div className="animate-card-flip mt-6 border-t border-[var(--color-line-strong)] pt-5">
            {typedDraft.trim() && (
              <div className="mb-3 rounded-lg bg-[var(--color-surface-low)] px-3 py-2 text-[13px] text-[var(--color-ink-muted)]">
                Your note: “{typedDraft}”
              </div>
            )}

            <div data-testid="anki-card-back">
              {backSlot ?? (
                <p className="text-[15.5px] leading-relaxed text-[var(--color-ink)]">{back}</p>
              )}
            </div>

            {boostedFoundations && boostedFoundations.length > 0 && (
              <div className="mt-4 flex items-center gap-1.5 text-[12.5px] text-[var(--color-ink-muted)]">
                <DomainGlyph kind="fire-wave" size={13} />
                <span>Credits foundations: {boostedFoundations.join(', ')}</span>
                <HelpHint text="Mastering an advanced card automatically extends review intervals on its prerequisites." />
              </div>
            )}

            <div className="mt-6 grid grid-cols-4 gap-2.5">
              {gradeButtons.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => onRate(g.id)}
                  className={`flex cursor-pointer flex-col items-center rounded-xl border px-3 py-2.5 transition-[transform,background-color,border-color] duration-120 active:scale-[0.97] ${
                    g.id === 'again'
                      ? 'border-[var(--color-err)]/30 bg-[var(--color-surface-low)] hover:border-[var(--color-err)]/60'
                      : 'border-[var(--color-line-strong)] bg-[var(--color-surface-elevated)] hover:bg-[var(--color-surface-hover)]'
                  }`}
                >
                  <span className="font-mono text-[11px] text-[var(--color-ink-faint)] tabular-nums">
                    {g.time}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[13.5px] font-medium text-[var(--color-ink)]">
                    {g.label}
                    <Kbd>{g.key}</Kbd>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   12. INVITING "ASK KIT" COMPOSER (FITTS'S LAW + STARTER PROMPTS + QUOTE DOCK)
   ═══════════════════════════════════════════════════════════════════════════ */

export function InvitingComposer({
  value,
  onChange,
  onSubmit,
  placeholder = 'Ask Kit a question, test an idea, or request an example...',
  textareaId,
  sendAriaLabel = 'Send message',
  streaming = false,
  onStop,
  disabled = false,
  quotedHighlight,
  onClearQuote,
  modelValue,
  onModelChange,
  modelOptions,
  centered = false,
  greetingTitle = 'What are we working through?',
  greetingSubtitle,
  starterPrompts,
  onPickStarter,
  attachActions,
  footerLeftSlot,
  className = '',
}: {
  value: string
  onChange: (next: string) => void
  onSubmit: (submittedText?: string) => void
  placeholder?: string
  textareaId?: string
  sendAriaLabel?: string
  streaming?: boolean
  onStop?: () => void
  disabled?: boolean
  quotedHighlight?: string | null
  onClearQuote?: () => void
  modelValue?: string
  onModelChange?: (next: string) => void
  modelOptions?: ReadonlyArray<SelectOption<string>>
  centered?: boolean
  greetingTitle?: string
  greetingSubtitle?: string
  starterPrompts?: string[]
  onPickStarter?: (prompt: string) => void
  attachActions?: Array<{ label: string; onSelect: () => void }>
  footerLeftSlot?: ReactNode
  className?: string
}) {
  const [plusOpen, setPlusOpen] = useState(false)

  const box = (
    <div
      className={`rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-surface-card)] p-3.5 shadow-[var(--shadow-sheet)] transition-[border-color,box-shadow] duration-150 focus-within:border-[var(--color-brand)]/75 focus-within:shadow-[0_0_0_3px_rgba(240,164,41,0.12)] ${className}`}
    >
      {quotedHighlight && (
        <div className="mb-2.5 flex items-start justify-between gap-2 rounded-lg border-l-2 border-[var(--color-brand)] bg-[var(--color-surface-low)] px-3 py-2 text-[13px] text-[var(--color-ink-muted)]">
          <span className="line-clamp-2">“{quotedHighlight}”</span>
          {onClearQuote && (
            <button
              type="button"
              aria-label="Remove quoted snippet"
              onClick={onClearQuote}
              className="mt-0.5 cursor-pointer text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
            >
              <X size={13} />
            </button>
          )}
        </div>
      )}

      <textarea
        id={textareaId}
        rows={centered ? 3 : 2}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (!streaming) onSubmit()
          }
        }}
        placeholder={placeholder}
        className="min-h-[54px] w-full resize-none bg-transparent text-[15px] leading-relaxed text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:outline-none disabled:opacity-50"
      />

      <div className="mt-2 flex items-center justify-between gap-2 pt-1">
        <div className="relative flex flex-wrap items-center gap-2">
          {attachActions && attachActions.length > 0 && (
            <div className="relative">
              <button
                type="button"
                aria-label="Add context or tool"
                onClick={() => setPlusOpen((o) => !o)}
                className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-surface-elevated)] text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-ink)] active:scale-[0.97]"
              >
                <Plus size={15} />
              </button>
              {plusOpen && (
                <div className="animate-popover-enter absolute bottom-[calc(100%+6px)] left-0 z-40 w-52 rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface-card)] p-1 shadow-[var(--shadow-float)]">
                  {attachActions.map((act) => (
                    <button
                      key={act.label}
                      type="button"
                      onClick={() => {
                        act.onSelect()
                        setPlusOpen(false)
                      }}
                      className="flex w-full cursor-pointer items-center rounded-lg px-2.5 py-1.5 text-left text-[13px] text-[var(--color-ink)] hover:bg-[var(--color-surface-hover)]"
                    >
                      {act.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {modelOptions && modelValue && onModelChange && (
            <SelectPopover
              size="xs"
              side="top"
              ariaLabel="Choose model"
              value={modelValue}
              onChange={onModelChange}
              options={modelOptions}
              menuWidthClass="w-60"
            />
          )}

          {footerLeftSlot}
        </div>

        {streaming && onStop ? (
          <Button variant="danger" size="sm" onClick={onStop} aria-label="Stop generating">
            <Square size={11} /> Stop
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            disabled={disabled || (!value.trim() && !quotedHighlight)}
            onClick={() => onSubmit()}
            aria-label={sendAriaLabel}
          >
            Ask Kit <Send size={12} />
          </Button>
        )}
      </div>
    </div>
  )

  if (!centered) return box

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col justify-center py-6">
      <div className="mb-4 flex items-center gap-3">
        <KitAvatar size={26} />
        <div>
          <h2 className="font-serif text-[22px] font-normal text-[var(--color-ink)]">
            {greetingTitle}
          </h2>
          {greetingSubtitle && (
            <p className="text-[13px] text-[var(--color-ink-muted)]">{greetingSubtitle}</p>
          )}
        </div>
      </div>

      {box}

      {starterPrompts && starterPrompts.length > 0 && (
        <div className="mt-3.5 flex flex-wrap gap-2">
          {starterPrompts.slice(0, 3).map((sp) => (
            <button
              key={sp}
              type="button"
              onClick={() => (onPickStarter ? onPickStarter(sp) : onSubmit(sp))}
              className="cursor-pointer rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface-card)] px-3.5 py-1.5 text-left text-[13px] text-[var(--color-ink-muted)] transition-[transform,color,border-color] duration-120 hover:border-[var(--color-ink-faint)] hover:text-[var(--color-ink)] active:scale-[0.98]"
            >
              {sp}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   13. VOICE WAVEFORM & NON-BLOCKING TOAST STACK
   ═══════════════════════════════════════════════════════════════════════════ */

const WAVE_HEIGHTS = [0.35, 0.7, 0.5, 0.95, 0.6, 1.0, 0.45, 0.85, 0.55, 0.75, 0.4, 0.9]

export function VoiceWaveform({
  recording,
  seconds = 0,
  className = '',
}: {
  recording: boolean
  seconds?: number
  className?: string
}) {
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')

  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface-low)] px-3.5 py-2.5 ${className}`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${
            recording ? 'animate-pulse-soft bg-[var(--color-err)]' : 'bg-[var(--color-ink-faint)]'
          }`}
        />
        <span className="text-[12.5px] text-[var(--color-ink-muted)]">
          {recording ? 'Listening' : 'Voice ready'}
        </span>
      </div>

      <div className="flex h-5 items-center gap-1" aria-hidden="true">
        {WAVE_HEIGHTS.map((h, i) => (
          <span
            key={i}
            style={{
              height: `${Math.round(h * 18)}px`,
              animation: recording
                ? `wave-bar ${650 + (i % 4) * 110}ms ease-in-out ${i * 55}ms infinite`
                : 'none',
              opacity: recording ? 0.9 : 0.35,
            }}
            className="w-[2.5px] origin-center rounded-full bg-[var(--color-ink)]"
          />
        ))}
      </div>

      <span className="font-mono text-[12px] text-[var(--color-ink-muted)] tabular-nums">
        {mm}:{ss}
      </span>
    </div>
  )
}

export interface ToastMessage {
  id: string
  title: string
  detail?: string
}

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastMessage[]
  onDismiss: (id: string) => void
}) {
  if (toasts.length === 0) return null
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => onDismiss(t.id)}
          className="animate-popover-enter pointer-events-auto flex max-w-xs cursor-pointer items-center gap-2.5 rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface-elevated)] px-3.5 py-2.5 text-[13px] shadow-[var(--shadow-float)]"
        >
          <Sparkles size={13} className="shrink-0 text-[var(--color-brand)]" />
          <div className="min-w-0">
            <div className="font-medium text-[var(--color-ink)]">{t.title}</div>
            {t.detail && (
              <div className="truncate text-[11.5px] text-[var(--color-ink-muted)]">{t.detail}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export { Bookmark }
