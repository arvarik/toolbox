import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { Lock, RotateCcw } from 'lucide-react'
import { Button, HelpHint, Kbd } from './Controls'
import { DomainGlyph } from './DomainGlyph'
import { KitLogo } from './KitLogo'

/* ═══════════════════════════════════════════════════════════════════════════
   1. ELASTIC HARDWARE SCRUBBER (MAGNETIC DETENTS + EDGE RUBBER-BANDING)
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
  const span = max - min

  const clampSnap = (raw: number, fine: boolean) => {
    if (span <= 0) return min
    if (!fine && ticks?.length) {
      const snapZone = span * 0.018
      for (const t of ticks) {
        if (Math.abs(raw - t) <= snapZone) return t
      }
    }
    const s = Math.max(0.0001, fine ? step * 0.2 : step)
    const snapped = Math.round((raw - min) / s) * s + min
    return Number(Math.min(max, Math.max(min, snapped)).toFixed(4))
  }

  const updateFromPointer = (clientX: number, fine: boolean) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || span <= 0) return
    const rawRatio = (clientX - rect.left) / rect.width
    if (rawRatio < 0) {
      setStretchPx(Math.max(-3, rawRatio * 10))
    } else if (rawRatio > 1) {
      setStretchPx(Math.min(3, (rawRatio - 1) * 10))
    } else {
      setStretchPx(0)
    }
    const ratio = Math.min(1, Math.max(0, rawRatio))
    onChange(clampSnap(min + ratio * span, fine))
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

  const pct = span <= 0 ? 0 : Math.min(100, Math.max(0, ((value - min) / span) * 100))

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

        {span > 0 &&
          ticks?.map((t) => {
            const tPct = ((t - min) / span) * 100
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
   2. MONOCHROME-UNTIL-OVERDUE MEMORY RING & MAGNETIC CURVE GRAPH
   ═══════════════════════════════════════════════════════════════════════════ */

export function RetrievabilityRing({
  retrievability,
  locked = false,
  size = 16,
  strokeWidth = 2,
  strokeColorOverride,
  showLabel = false,
  centerLabel,
}: {
  retrievability: number
  locked?: boolean
  size?: number
  strokeWidth?: number
  strokeColorOverride?: string
  showLabel?: boolean
  centerLabel?: ReactNode
}) {
  if (locked) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[11.5px] text-[var(--color-ink-faint)]">
        <Lock size={Math.max(11, size - 3)} />
        {showLabel && <span>Locked</span>}
      </span>
    )
  }

  const r = Math.max(0, Math.min(100, retrievability))
  const radius = (size - strokeWidth) / 2
  const circ = 2 * Math.PI * radius
  const offset = circ * (1 - r / 100)

  const overdue = r < 70
  const strokeColor = strokeColorOverride ?? (overdue ? 'var(--color-err)' : 'var(--color-ink-muted)')
  const textClass = overdue
    ? 'text-[var(--color-err)] font-medium'
    : 'text-[var(--color-ink-muted)]'

  return (
    <span className="relative inline-flex shrink-0 items-center justify-center gap-1.5 tabular-nums">
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
      {centerLabel !== undefined && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[10px] font-semibold text-[var(--color-ink)]">
          {centerLabel}
        </span>
      )}
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
   3. PURE ANKI CARD STACK (ZERO CONFIDENCE GATE · GOAL-GRADIENT + PEAK-END)
   ═══════════════════════════════════════════════════════════════════════════ */

export type AnkiGrade = 'again' | 'hard' | 'good' | 'easy'

export function AnkiGradeBar({
  intervals,
  onRate,
  disabled = false,
  className = '',
}: {
  intervals: { again: string; hard: string; good: string; easy: string }
  onRate: (grade: AnkiGrade) => void
  disabled?: boolean
  className?: string
}) {
  const gradeButtons: Array<{
    id: AnkiGrade
    label: string
    key: string
    time: string
    cls: string
  }> = [
    {
      id: 'again',
      label: 'Again',
      key: '1',
      time: intervals.again,
      cls: 'border-[var(--color-err)]/35 bg-[var(--color-surface-low)] hover:border-[var(--color-err)]/65',
    },
    {
      id: 'hard',
      label: 'Hard',
      key: '2',
      time: intervals.hard,
      cls: 'border-[var(--color-line-strong)] bg-[var(--color-surface-elevated)] hover:bg-[var(--color-surface-hover)]',
    },
    {
      id: 'good',
      label: 'Good',
      key: '3',
      time: intervals.good,
      cls: 'border-[var(--color-ok)]/35 bg-[var(--color-surface-elevated)] hover:border-[var(--color-ok)]/65 hover:bg-[var(--color-surface-hover)]',
    },
    {
      id: 'easy',
      label: 'Easy',
      key: '4',
      time: intervals.easy,
      cls: 'border-[var(--color-brand)]/35 bg-[var(--color-surface-elevated)] hover:border-[var(--color-brand)]/65 hover:bg-[var(--color-surface-hover)]',
    },
  ]

  return (
    <div className={`srs-rating-buttons grid grid-cols-4 gap-1.5 sm:gap-2.5 ${className}`}>
      {gradeButtons.map((g) => (
        <button
          key={g.id}
          type="button"
          data-testid={`grade-btn-${g.id}`}
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation()
            onRate(g.id)
          }}
          className={`srs-rating-btn flex min-h-[54px] min-w-0 cursor-pointer flex-col items-center justify-center rounded-xl border px-1.5 py-2.5 transition-[transform,background-color,border-color,opacity] duration-120 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 sm:px-3 ${g.cls}`}
        >
          <span className="font-mono text-[11px] text-[var(--color-ink-muted)] tabular-nums">
            {g.time}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-ink)] sm:text-[13.5px]">
            {g.label}
            <Kbd className="hidden sm:inline-flex">{g.key}</Kbd>
          </span>
        </button>
      ))}
    </div>
  )
}

export function AnkiCardStack({
  cardKey,
  front,
  back,
  frontSlot,
  backSlot,
  headerSlot,
  footerSlot,
  emptySlot,
  topicLabel,
  intervals,
  remainingCount,
  boostedFoundations,
  submitting = false,
  typeMode: controlledTypeMode,
  onTypeModeChange,
  frontTestId = 'anki-card-front',
  backTestId = 'anki-card-back',
  typeInputTestId = 'review-type-answer-input',
  revealTestId = 'reveal-answer-btn',
  onRate,
  onReset,
}: {
  cardKey?: string
  front: string
  back: string
  frontSlot?: ReactNode
  backSlot?: ReactNode
  headerSlot?: ReactNode
  footerSlot?: ReactNode
  emptySlot?: ReactNode
  topicLabel: string
  intervals: { again: string; hard: string; good: string; easy: string }
  remainingCount: number
  boostedFoundations?: string[]
  submitting?: boolean
  typeMode?: boolean
  onTypeModeChange?: (open: boolean) => void
  frontTestId?: string
  backTestId?: string
  typeInputTestId?: string
  revealTestId?: string
  onRate: (grade: AnkiGrade) => void
  onReset?: () => void
}) {
  const cardIdentity = `${cardKey ?? ''}\u0000${front}\u0000${remainingCount}`
  const [flippedCard, setFlippedCard] = useState<string | null>(null)
  const flipped = flippedCard === cardIdentity
  const [internalTypeMode, setInternalTypeMode] = useState(false)
  const typeMode = controlledTypeMode ?? internalTypeMode
  const [draftState, setDraftState] = useState<{ card: string; text: string }>({
    card: cardIdentity,
    text: '',
  })
  const typedDraft = typeMode && draftState.card === cardIdentity ? draftState.text : ''
  const typeInputRef = useRef<HTMLTextAreaElement>(null)

  const toggleTypeMode = () => {
    const next = !typeMode
    if (!next) setDraftState({ card: cardIdentity, text: '' })
    if (onTypeModeChange) onTypeModeChange(next)
    else setInternalTypeMode(next)
  }

  useEffect(() => {
    if (typeMode && !flipped) {
      typeInputRef.current?.focus()
    }
  }, [typeMode, flipped, cardIdentity])

  useEffect(() => {
    if (remainingCount <= 0) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target
      if (target instanceof Element) {
        const tag = target.tagName.toUpperCase()
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          (target instanceof HTMLElement && target.isContentEditable)
        ) {
          return
        }
      }
      if (!flipped && (e.code === 'Space' || e.key === ' ' || e.key === 'Enter')) {
        if (target instanceof Element && target.closest('a, button, [role="button"], summary')) {
          return
        }
        e.preventDefault()
        setFlippedCard(cardIdentity)
      } else if (flipped && !submitting) {
        if (e.key === '1') {
          e.preventDefault()
          onRate('again')
        } else if (e.key === '2') {
          e.preventDefault()
          onRate('hard')
        } else if (e.key === '3') {
          e.preventDefault()
          onRate('good')
        } else if (e.key === '4') {
          e.preventDefault()
          onRate('easy')
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cardIdentity, flipped, onRate, remainingCount, submitting])

  if (remainingCount <= 0) {
    if (emptySlot) return <>{emptySlot}</>
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
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setFlippedCard(null)
                setDraftState({ card: '', text: '' })
                onReset()
              }}
            >
              <RotateCcw size={13} /> Replay sample cards
            </Button>
          </div>
        )}
      </div>
    )
  }

  const stackLayers = Math.min(3, Math.max(0, remainingCount - 1))

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

      <article className="notebook-sheet relative z-10 rounded-2xl p-6 sm:p-8">
        {headerSlot ?? (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-[var(--color-ink-muted)]">
            <span>{topicLabel}</span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={toggleTypeMode}
                className={`-my-1 inline-flex min-h-[36px] cursor-pointer items-center px-2 transition-colors ${
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
        )}

        <div data-testid={frontTestId}>
          {frontSlot ?? (
            <h3 className="font-serif text-[21px] leading-[1.42] font-normal text-[var(--color-ink)]">
              {front}
            </h3>
          )}
        </div>

        {typeMode && !flipped && (
          <div className="mt-5">
            <textarea
              ref={typeInputRef}
              data-testid={typeInputTestId}
              aria-label="Jot your recall before flipping"
              rows={3}
              value={typedDraft}
              onChange={(e) => setDraftState({ card: cardIdentity, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
                  e.preventDefault()
                  setFlippedCard(cardIdentity)
                }
              }}
              placeholder="Jot your recall before flipping (Enter to reveal, Shift+Enter for new line)..."
              className="max-h-48 min-h-[76px] w-full resize-y overflow-y-auto rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface-low)] px-4 py-3 text-[16px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-brand)] focus:outline-none sm:text-[14.5px]"
            />
          </div>
        )}

        {!flipped ? (
          <div className="mt-6 flex items-center justify-center border-t border-[var(--color-line)] pt-5">
            <Button
              variant="primary"
              size="md"
              data-testid={revealTestId}
              onClick={() => setFlippedCard(cardIdentity)}
              className="min-h-[48px] w-full justify-center py-2.5 sm:w-auto sm:min-w-52"
            >
              <span>Reveal Answer</span>
              <Kbd className="hidden sm:inline-flex">Space</Kbd>
            </Button>
          </div>
        ) : (
          <div className="animate-card-flip mt-6 border-t border-[var(--color-line-strong)] pt-5">
            {typedDraft.trim() && (
              <div className="mb-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-low)] px-3.5 py-2.5 text-[13px] whitespace-pre-wrap break-words text-[var(--color-ink-muted)]">
                <span className="font-medium text-[var(--color-ink)]">Your recall:</span>{' '}
                {typedDraft.trim()}
              </div>
            )}

            <div data-testid={backTestId}>
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

            <div className="max-sm:sticky max-sm:bottom-0 max-sm:z-20 max-sm:-mx-6 max-sm:mt-5 max-sm:border-t max-sm:border-[var(--color-line)] max-sm:bg-[var(--color-surface-card)]/95 max-sm:px-3 max-sm:pt-2.5 max-sm:pb-[calc(0.625rem+env(safe-area-inset-bottom,0px))] max-sm:backdrop-blur-md">
              <AnkiGradeBar
                intervals={intervals}
                onRate={onRate}
                disabled={submitting}
                className="sm:mt-6"
              />
            </div>

            {footerSlot}
          </div>
        )}
      </article>
    </div>
  )
}
