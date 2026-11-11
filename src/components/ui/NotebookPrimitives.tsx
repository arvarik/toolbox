import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import {
  Check,
  Layers,
  MessageSquare,
  Plus,
  Send,
  Square,
  X,
} from 'lucide-react'
import type { HighlightColor } from '../../utils/api'
import { Button, FluidAccordion, SelectPopover, type SelectOption } from './Controls'
import { KitAvatar } from './KitLogo'

export type { HighlightColor }

export interface TextbookHighlight {
  id: string
  pageId?: string
  quote: string
  prefix?: string
  suffix?: string
  color: HighlightColor
  note?: string
  cardId?: string | null
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. NOTEBOOK SHEET & INTERACTIVE TOP-RIGHT DOGEAR CORNER (ZEIGARNIK EFFECT)
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
      className="group absolute top-0 right-0 z-20 h-11 w-11 cursor-pointer overflow-hidden rounded-tr-xl focus-visible:outline-offset-[-2px] sm:h-9 sm:w-9"
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
   2. ORGANIC 3-INK TEXTBOOK HIGHLIGHTER & SELECTION TOOLBAR
   ═══════════════════════════════════════════════════════════════════════════ */

const INK_SWATCHES: Array<{ color: HighlightColor; label: string; dotBg: string }> = [
  { color: 'amber', label: 'Key idea (Amber)', dotBg: '#f0a429' },
  { color: 'sage', label: 'Formula / Example (Sage)', dotBg: '#6fbf94' },
  { color: 'coral', label: 'Question / Revisit (Coral)', dotBg: '#f08c82' },
]

function findBestQuoteMatch(
  fullText: string,
  quote: string,
  prefix = '',
  suffix = '',
): number {
  let idx = fullText.indexOf(quote)
  if (idx < 0) return -1
  if (!prefix && !suffix) return idx

  let bestIdx = idx
  let bestScore = -1
  while (idx >= 0) {
    let score = 0
    if (prefix) {
      const before = fullText.slice(Math.max(0, idx - prefix.length), idx)
      if (before.endsWith(prefix)) score += 4
      else if (before.trimEnd().endsWith(prefix.trimEnd().slice(-16))) score += 2
    }
    if (suffix) {
      const after = fullText.slice(idx + quote.length, idx + quote.length + suffix.length)
      if (after.startsWith(suffix)) score += 4
      else if (after.trimStart().startsWith(suffix.trimStart().slice(0, 16))) score += 2
    }
    if (score > bestScore) {
      bestScore = score
      bestIdx = idx
    }
    idx = fullText.indexOf(quote, idx + 1)
  }
  return bestIdx
}

const EXCLUDED_HIGHLIGHT_SELECTOR = 'mark[data-hl-id], pre, .katex, svg, button'
const BLOCK_ANCESTOR_SELECTOR =
  'p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, pre, div, section, article'

function collectHighlightableSegments(root: HTMLElement): {
  segments: Array<{ node: Text; start: number; end: number }>
  combined: string
} {
  const segments: Array<{ node: Text; start: number; end: number }> = []
  let combined = ''
  let lastBlock: Element | null = null
  let sawExcludedSinceLast = false

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const el = node.parentElement
      if (!el) return NodeFilter.FILTER_REJECT
      if (el.closest(EXCLUDED_HIGHLIGHT_SELECTOR)) {
        sawExcludedSinceLast = true
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })

  let current = walker.nextNode() as Text | null
  while (current) {
    const val = current.nodeValue ?? ''
    if (val.length > 0) {
      const block = current.parentElement?.closest(BLOCK_ANCESTOR_SELECTOR) ?? root
      if (segments.length > 0 && (sawExcludedSinceLast || block !== lastBlock)) {
        combined += '\u0000'
      }
      segments.push({ node: current, start: combined.length, end: combined.length + val.length })
      combined += val
      lastBlock = block
      sawExcludedSinceLast = false
    }
    current = walker.nextNode() as Text | null
  }

  return { segments, combined }
}

function applyHighlightsToDom(root: HTMLElement, highlights: TextbookHighlight[]) {
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

    const { segments, combined } = collectHighlightableSegments(root)

    const matchStart = findBestQuoteMatch(combined, h.quote, h.prefix, h.suffix)
    if (matchStart < 0) continue
    const matchEnd = matchStart + h.quote.length

    const overlapping = segments.filter((s) => s.end > matchStart && s.start < matchEnd)
    for (let i = overlapping.length - 1; i >= 0; i--) {
      const seg = overlapping[i]
      const localStart = Math.max(0, matchStart - seg.start)
      const localEnd = Math.min(seg.end - seg.start, matchEnd - seg.start)
      if (localEnd <= localStart) continue

      const target = seg.node.splitText(localStart)
      target.splitText(localEnd - localStart)
      const mark = document.createElement('mark')
      mark.setAttribute('data-hl-id', h.id)
      mark.className = `hl-mark hl-${h.color} text-[var(--color-ink)]`
      if (h.note) mark.title = h.note
      target.parentNode?.insertBefore(mark, target)
      mark.appendChild(target)
    }
  }
}

interface HighlightProseSubscriber {
  getRoot: () => HTMLElement | null
  isInteracting: () => boolean
  hasSelection: () => boolean
  evaluate: () => void
  clear: () => void
}

const highlightProseSubscribers = new Set<HighlightProseSubscriber>()
let activeHighlightSubscriber: HighlightProseSubscriber | null = null
let sharedSelectionTimer: ReturnType<typeof setTimeout> | undefined
let isMouseDragging = false
let sharedListenersAttached = false

function isHighlightToolbarTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest('[data-testid="highlight-selection-toolbar"]'))
  )
}

function clearSharedSelectionTimer(): void {
  if (sharedSelectionTimer !== undefined) {
    clearTimeout(sharedSelectionTimer)
    sharedSelectionTimer = undefined
  }
}

function routeSharedSelection(): void {
  const sel = typeof window !== 'undefined' ? window.getSelection() : null
  const hasRange = Boolean(sel && !sel.isCollapsed && sel.rangeCount > 0)
  const targetNode =
    hasRange && sel ? (sel.anchorNode ?? sel.getRangeAt(0).commonAncestorContainer) : null

  let matched: HighlightProseSubscriber | null = null
  if (targetNode) {
    for (const sub of highlightProseSubscribers) {
      const root = sub.getRoot()
      if (root && root.contains(targetNode)) {
        matched = sub
        break
      }
    }
  }

  if (activeHighlightSubscriber && activeHighlightSubscriber !== matched) {
    if (!activeHighlightSubscriber.isInteracting()) {
      activeHighlightSubscriber.clear()
    }
  }

  for (const sub of highlightProseSubscribers) {
    if (sub !== matched && sub.hasSelection() && !sub.isInteracting()) {
      sub.clear()
    }
  }

  activeHighlightSubscriber = matched
  if (matched && !matched.isInteracting()) {
    matched.evaluate()
  }
}

function onSharedMouseDown(e: MouseEvent): void {
  if (isHighlightToolbarTarget(e.target)) return
  const button = typeof e.button === 'number' ? e.button : 0
  const buttons = typeof e.buttons === 'number' ? e.buttons : 0
  if (button === 0 || (buttons & 1) === 1) {
    isMouseDragging = true
    clearSharedSelectionTimer()
  }
}

function onSharedPointerDown(e: PointerEvent): void {
  if (isHighlightToolbarTarget(e.target)) return
  if (e.pointerType !== 'mouse') {
    isMouseDragging = false
    return
  }
  const button = typeof e.button === 'number' ? e.button : 0
  const buttons = typeof e.buttons === 'number' ? e.buttons : 0
  if (button === 0 || (buttons & 1) === 1) {
    isMouseDragging = true
    clearSharedSelectionTimer()
  }
}

function onSharedTouchStart(e: TouchEvent): void {
  if (isHighlightToolbarTarget(e.target)) return
  isMouseDragging = false
}

function onSharedMouseMove(e: MouseEvent): void {
  if (!isMouseDragging) return
  if (typeof e.buttons === 'number' && (e.buttons & 1) === 0) {
    finishSharedMouseDrag()
  }
}

function finishSharedMouseDrag(e?: Event): void {
  if (e && 'pointerType' in e) {
    const pt = (e as PointerEvent).pointerType
    if (pt && pt !== 'mouse') return
  }
  if (e && 'buttons' in e && e.type !== 'pointercancel' && e.type !== 'dragend') {
    const buttons = (e as MouseEvent).buttons
    if (typeof buttons === 'number' && (buttons & 1) === 1) return
  }
  const wasDragging = isMouseDragging
  isMouseDragging = false
  if (wasDragging) {
    clearSharedSelectionTimer()
    routeSharedSelection()
  }
}

function onSharedWindowBlur(): void {
  isMouseDragging = false
  clearSharedSelectionTimer()
}

function onSharedVisibilityChange(): void {
  if (document.hidden) {
    isMouseDragging = false
    clearSharedSelectionTimer()
  }
}

function onSharedSelectionChange(): void {
  if (isMouseDragging) {
    clearSharedSelectionTimer()
    return
  }
  clearSharedSelectionTimer()
  sharedSelectionTimer = setTimeout(() => {
    sharedSelectionTimer = undefined
    if (isMouseDragging) return
    routeSharedSelection()
  }, 180)
}

function attachSharedHighlightListeners(): void {
  if (sharedListenersAttached || typeof document === 'undefined' || typeof window === 'undefined') {
    return
  }
  sharedListenersAttached = true
  isMouseDragging = false
  document.addEventListener('selectionchange', onSharedSelectionChange)
  document.addEventListener('mousedown', onSharedMouseDown, true)
  document.addEventListener('pointerdown', onSharedPointerDown, true)
  document.addEventListener('touchstart', onSharedTouchStart, true)
  document.addEventListener('visibilitychange', onSharedVisibilityChange)
  window.addEventListener('mousemove', onSharedMouseMove, true)
  window.addEventListener('mouseup', finishSharedMouseDrag, true)
  window.addEventListener('pointerup', finishSharedMouseDrag, true)
  window.addEventListener('pointercancel', finishSharedMouseDrag, true)
  window.addEventListener('dragend', finishSharedMouseDrag, true)
  window.addEventListener('blur', onSharedWindowBlur)
}

function detachSharedHighlightListeners(): void {
  if (!sharedListenersAttached || typeof document === 'undefined' || typeof window === 'undefined') {
    return
  }
  sharedListenersAttached = false
  isMouseDragging = false
  activeHighlightSubscriber = null
  clearSharedSelectionTimer()
  document.removeEventListener('selectionchange', onSharedSelectionChange)
  document.removeEventListener('mousedown', onSharedMouseDown, true)
  document.removeEventListener('pointerdown', onSharedPointerDown, true)
  document.removeEventListener('touchstart', onSharedTouchStart, true)
  document.removeEventListener('visibilitychange', onSharedVisibilityChange)
  window.removeEventListener('mousemove', onSharedMouseMove, true)
  window.removeEventListener('mouseup', finishSharedMouseDrag, true)
  window.removeEventListener('pointerup', finishSharedMouseDrag, true)
  window.removeEventListener('pointercancel', finishSharedMouseDrag, true)
  window.removeEventListener('dragend', finishSharedMouseDrag, true)
  window.removeEventListener('blur', onSharedWindowBlur)
}

export function HighlightableProse({
  children,
  contentKey,
  highlights,
  onAddHighlight,
  onRemoveHighlight,
  onAskKit,
  onMakeCard,
  className = '',
}: {
  children: ReactNode
  contentKey?: string
  highlights: TextbookHighlight[]
  onAddHighlight: (quote: string, color: HighlightColor, prefix?: string, suffix?: string) => void
  onRemoveHighlight?: (id: string) => void
  onAskKit?: (quote: string) => void
  onMakeCard?: (
    quote: string,
    context?: { prefix: string; suffix: string; highlightId?: string },
  ) => void
  className?: string
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const richContentRef = useRef<HTMLDivElement>(null)
  const [selection, setSelection] = useState<{
    text: string
    prefix: string
    suffix: string
    canHighlight: boolean
    x: number
    y: number
  } | null>(null)
  const hasSelectionRef = useRef(false)
  hasSelectionRef.current = selection !== null
  const toolbarInteractingRef = useRef(false)
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const markToolbarInteracting = () => {
    if (releaseTimerRef.current) {
      clearTimeout(releaseTimerRef.current)
      releaseTimerRef.current = null
    }
    toolbarInteractingRef.current = true
  }

  useEffect(() => {
    if (!richContentRef.current) return
    applyHighlightsToDom(richContentRef.current, highlights)
  }, [children, contentKey, highlights])

  useEffect(() => {
    if (!selection) {
      toolbarInteractingRef.current = false
      if (releaseTimerRef.current) {
        clearTimeout(releaseTimerRef.current)
        releaseTimerRef.current = null
      }
      return
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        toolbarInteractingRef.current = false
        setSelection(null)
      }
    }
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        toolbarInteractingRef.current = false
        setSelection(null)
      }
    }
    const scheduleRelease = () => {
      if (!toolbarInteractingRef.current) return
      if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current)
      releaseTimerRef.current = setTimeout(() => {
        toolbarInteractingRef.current = false
        releaseTimerRef.current = null
      }, 80)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointerup', scheduleRelease)
    window.addEventListener('pointercancel', scheduleRelease)
    window.addEventListener('touchend', scheduleRelease)
    window.addEventListener('touchcancel', scheduleRelease)
    window.addEventListener('mouseup', scheduleRelease)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', scheduleRelease)
      window.removeEventListener('pointercancel', scheduleRelease)
      window.removeEventListener('touchend', scheduleRelease)
      window.removeEventListener('touchcancel', scheduleRelease)
      window.removeEventListener('mouseup', scheduleRelease)
      if (releaseTimerRef.current) {
        clearTimeout(releaseTimerRef.current)
        releaseTimerRef.current = null
      }
    }
  }, [selection])

  const checkSelectionRef = useRef<() => void>(() => {})

  const checkSelection = () => {
    if (toolbarInteractingRef.current) return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      if (hasSelectionRef.current) setSelection(null)
      return
    }
    const text = sel.toString().trim()
    if (text.length < 3 || !wrapRef.current || !richContentRef.current) {
      if (hasSelectionRef.current) setSelection(null)
      return
    }
    const range = sel.getRangeAt(0)
    if (!richContentRef.current.contains(range.commonAncestorContainer)) {
      if (hasSelectionRef.current) setSelection(null)
      return
    }

    const startEl =
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement
    const endEl =
      range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement
    const intersectsExcluded = Boolean(
      startEl?.closest(EXCLUDED_HIGHLIGHT_SELECTOR) ||
        endEl?.closest(EXCLUDED_HIGHLIGHT_SELECTOR) ||
        range.cloneContents().querySelector(EXCLUDED_HIGHLIGHT_SELECTOR),
    )

    const { segments, combined } = collectHighlightableSegments(richContentRef.current)
    let matchPos = -1
    if (!intersectsExcluded && !text.includes('\u0000')) {
      const startSeg = segments.find((s) => s.node === range.startContainer)
      const approxOffset = startSeg ? startSeg.start + range.startOffset : 0
      const exactAtOffset = combined.indexOf(text, Math.max(0, approxOffset - 4))
      matchPos = exactAtOffset >= 0 ? exactAtOffset : combined.indexOf(text)
    }

    let prefix = ''
    let suffix = ''
    if (matchPos >= 0) {
      const rawPrefix = matchPos > 0 ? combined.slice(Math.max(0, matchPos - 48), matchPos) : ''
      const rawSuffix = combined.slice(matchPos + text.length, matchPos + text.length + 48)
      const lastSep = rawPrefix.lastIndexOf('\u0000')
      const firstSep = rawSuffix.indexOf('\u0000')
      prefix = lastSep >= 0 ? rawPrefix.slice(lastSep + 1) : rawPrefix
      suffix = firstSep >= 0 ? rawSuffix.slice(0, firstSep) : rawSuffix
    } else {
      const fullText = richContentRef.current.textContent ?? ''
      const fallbackPos = fullText.indexOf(text)
      if (fallbackPos >= 0) {
        prefix = fallbackPos > 0 ? fullText.slice(Math.max(0, fallbackPos - 48), fallbackPos) : ''
        suffix = fullText.slice(fallbackPos + text.length, fallbackPos + text.length + 48)
      }
    }

    const canHighlight =
      matchPos >= 0 && findBestQuoteMatch(combined, text, prefix, suffix) >= 0
    if (!canHighlight && !onMakeCard && !onAskKit) {
      setSelection(null)
      return
    }

    const rect =
      typeof range.getBoundingClientRect === 'function'
        ? range.getBoundingClientRect()
        : { left: 0, top: 0, bottom: 0, width: 0, height: 0 }
    const host = wrapRef.current.getBoundingClientRect()
    const isCoarse =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches
    const rawTop = rect.top - host.top
    const rawBottom = rect.bottom - host.top
    const placeBelow = isCoarse || (host.height > 0 && rawTop < 46)
    const halfClamp = host.width > 0 ? Math.min(112, Math.floor(host.width / 2)) : 96
    const x =
      host.width > 0 && host.width < 260
        ? host.width / 2
        : Math.min(
            Math.max(halfClamp, rect.left - host.left + rect.width / 2),
            Math.max(halfClamp, host.width - halfClamp),
          )
    const y = placeBelow ? Math.max(8, rawBottom + 8) : Math.max(0, rawTop - 42)

    setSelection({
      text,
      prefix,
      suffix,
      canHighlight,
      x,
      y,
    })
  }
  checkSelectionRef.current = checkSelection

  useEffect(() => {
    const subscriber: HighlightProseSubscriber = {
      getRoot: () => richContentRef.current,
      isInteracting: () => toolbarInteractingRef.current,
      hasSelection: () => hasSelectionRef.current,
      evaluate: () => checkSelectionRef.current(),
      clear: () => setSelection(null),
    }
    const wasEmpty = highlightProseSubscribers.size === 0
    highlightProseSubscribers.add(subscriber)
    if (wasEmpty) {
      attachSharedHighlightListeners()
    }
    return () => {
      highlightProseSubscribers.delete(subscriber)
      if (activeHighlightSubscriber === subscriber) {
        activeHighlightSubscriber = null
      }
      if (highlightProseSubscribers.size === 0) {
        detachSharedHighlightListeners()
      }
    }
  }, [])

  const commitHighlight = (color: HighlightColor) => {
    if (!selection?.canHighlight) return
    toolbarInteractingRef.current = false
    onAddHighlight(selection.text, color, selection.prefix, selection.suffix)
    window.getSelection()?.removeAllRanges()
    setSelection(null)
  }

  return (
    <div
      ref={wrapRef}
      onMouseUp={(e) => {
        if ((e.buttons & 1) === 1) return
        isMouseDragging = false
        routeSharedSelection()
      }}
      onKeyUp={() => routeSharedSelection()}
      className={`relative text-[15.5px] leading-[1.72] text-[var(--color-ink)] ${className}`}
    >
      {selection && (
        <div
          data-testid="highlight-selection-toolbar"
          onPointerDown={markToolbarInteracting}
          onTouchStart={markToolbarInteracting}
          onMouseDown={(e) => {
            markToolbarInteracting()
            e.preventDefault()
          }}
          onMouseUp={(e) => e.stopPropagation()}
          style={{ left: `${selection.x}px`, top: `${selection.y}px` }}
          className="animate-popover-enter absolute z-30 flex max-w-[calc(100%-8px)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-surface-elevated)] px-2 py-1 text-[12px] shadow-[var(--shadow-float)]"
        >
          {selection.canHighlight && (
            <>
              <button
                type="button"
                onClick={() => commitHighlight('amber')}
                className="inline-flex min-h-[34px] cursor-pointer items-center gap-1.5 rounded px-2 py-1 font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-hover)] sm:min-h-0"
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
                  className="flex h-8 w-7 cursor-pointer items-center justify-center rounded hover:bg-[var(--color-surface-hover)] sm:h-6 sm:w-5"
                >
                  <span className="h-3 w-3 rounded-full sm:h-2.5 sm:w-2.5" style={{ backgroundColor: sw.dotBg }} />
                </button>
              ))}
            </>
          )}
          {onMakeCard && (
            <>
              {selection.canHighlight && (
                <span className="h-3.5 w-px bg-[var(--color-line-strong)]" />
              )}
              <button
                type="button"
                onClick={() => {
                  toolbarInteractingRef.current = false
                  onMakeCard(selection.text, {
                    prefix: selection.prefix,
                    suffix: selection.suffix,
                  })
                  window.getSelection()?.removeAllRanges()
                  setSelection(null)
                }}
                className="min-h-[34px] cursor-pointer rounded px-2 py-1 font-medium whitespace-nowrap text-[var(--color-ink)] hover:bg-[var(--color-surface-hover)] sm:min-h-0"
              >
                Make Card
              </button>
            </>
          )}
          {onAskKit && (
            <>
              {(selection.canHighlight || Boolean(onMakeCard)) && (
                <span className="h-3.5 w-px bg-[var(--color-line-strong)]" />
              )}
              <button
                type="button"
                onClick={() => {
                  toolbarInteractingRef.current = false
                  onAskKit(selection.text)
                  window.getSelection()?.removeAllRanges()
                  setSelection(null)
                }}
                className="inline-flex min-h-[34px] cursor-pointer items-center gap-1 rounded px-2 py-1 font-medium whitespace-nowrap text-[var(--color-brand)] hover:bg-[var(--color-surface-hover)] sm:min-h-0"
              >
                <MessageSquare size={11} />
                Ask Kit
              </button>
            </>
          )}
        </div>
      )}

      <div ref={richContentRef}>{children}</div>

      {highlights.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-[var(--color-line)] pt-3">
          {highlights.map((h) => (
            <span
              key={h.id}
              className={`hl-${h.color} inline-flex max-w-full items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[var(--color-ink)] sm:gap-1.5 sm:py-0.5`}
            >
              <span className="min-w-0 max-w-[180px] truncate sm:max-w-[240px]">“{h.quote}”</span>
              {onMakeCard && !h.cardId && (
                <button
                  type="button"
                  title="Make flashcard from highlight"
                  aria-label="Make flashcard from highlight"
                  onClick={() =>
                    onMakeCard(h.quote, {
                      prefix: h.prefix ?? '',
                      suffix: h.suffix ?? '',
                      highlightId: h.id,
                    })
                  }
                  className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-ink)] sm:h-auto sm:w-auto"
                >
                  <Layers size={12} />
                </button>
              )}
              {onAskKit && (
                <button
                  type="button"
                  title="Ask Kit about this highlight"
                  aria-label="Ask Kit about highlight"
                  onClick={() => onAskKit(h.quote)}
                  className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-ink)] sm:h-auto sm:w-auto"
                >
                  <MessageSquare size={12} />
                </button>
              )}
              {onRemoveHighlight && (
                <button
                  type="button"
                  title="Remove highlight"
                  aria-label="Remove highlight"
                  onClick={() => onRemoveHighlight(h.id)}
                  className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-ink)] sm:h-auto sm:w-auto"
                >
                  <X size={12} />
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
   3. CLEAN RENDERED NOTE UPDATE CARD + OPTIONAL DIFF DISCLOSURE
   ═══════════════════════════════════════════════════════════════════════════ */

export function NoteUpdateCard({
  sectionName,
  summaryBullets,
  children,
  badge,
  headerLeft,
  hunks,
  accepted,
  onToggleAccept,
  className = '',
}: {
  sectionName: string
  summaryBullets?: string[]
  children?: ReactNode
  badge?: ReactNode
  headerLeft?: ReactNode
  hunks: Array<{ type: 'ctx' | 'del' | 'add'; line: string }>
  accepted?: boolean
  onToggleAccept?: () => void
  className?: string
}) {
  const [showDiff, setShowDiff] = useState(false)

  return (
    <div className={`border-b border-[var(--color-line)] py-4 first:pt-1 last:border-b-0 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {headerLeft}
          <h4 className="truncate font-serif text-[15px] font-medium text-[var(--color-ink)]">
            {sectionName}
          </h4>
          {badge}
        </div>
        {onToggleAccept && accepted !== undefined && (
          <Button size="xs" variant={accepted ? 'ghost' : 'secondary'} onClick={onToggleAccept}>
            {accepted ? (
              <>
                <Check size={12} className="text-[var(--color-ok)]" /> Selected
              </>
            ) : (
              'Include'
            )}
          </Button>
        )}
      </div>

      {summaryBullets && summaryBullets.length > 0 && (
        <ul className="mt-2 space-y-1.5 text-[13.5px] leading-snug text-[var(--color-ink-muted)]">
          {summaryBullets.map((b, idx) => (
            <li key={idx} className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--color-ink-faint)]" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}

      {children}

      {hunks.length > 0 && (
        <div className="mt-2.5">
          <button
            type="button"
            onClick={() => setShowDiff((d) => !d)}
            className="cursor-pointer text-[12px] font-medium text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
          >
            {showDiff ? 'Hide exact changes' : 'Show diff'}
          </button>

          <FluidAccordion open={showDiff}>
            <div className="mt-2 max-h-60 overflow-y-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-low)] text-[12px]">
              {hunks.map((h, i) => {
                const rowClass =
                  h.type === 'add'
                    ? 'border-l-2 border-[var(--color-diff-add-bar)] bg-[var(--color-diff-add-bg)] text-[var(--color-diff-add-ink)]'
                    : h.type === 'del'
                      ? 'border-l-2 border-[var(--color-diff-del-bar)] bg-[var(--color-diff-del-bg)] text-[var(--color-diff-del-ink)] line-through opacity-85'
                      : 'border-l-2 border-transparent text-[var(--color-ink-muted)]'
                return (
                  <div key={i} className={`flex gap-2 px-3 py-1 font-mono leading-snug ${rowClass}`}>
                    <span className="w-3 shrink-0 select-none">
                      {h.type === 'add' ? '+' : h.type === 'del' ? '−' : ' '}
                    </span>
                    <span className="min-w-0 break-words whitespace-pre-wrap">{h.line || ' '}</span>
                  </div>
                )
              })}
            </div>
          </FluidAccordion>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. INVITING "ASK KIT" COMPOSER & VOICE WAVEFORM
   ═══════════════════════════════════════════════════════════════════════════ */

export function InvitingComposer({
  value,
  onChange,
  onSubmit,
  placeholder = 'Ask Kit a question, test an idea, or request an example...',
  textareaId,
  textareaRef,
  textareaClassName = '',
  sendAriaLabel = 'Send message',
  sendButtonClassName = '',
  submitLabel = 'Ask Kit',
  streaming = false,
  onStop,
  disabled = false,
  quotedHighlight,
  quoteTestId = 'docked-quote-pill',
  onClearQuote,
  modelValue,
  onModelChange,
  modelOptions,
  centered = false,
  compact = false,
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
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  textareaClassName?: string
  sendAriaLabel?: string
  sendButtonClassName?: string
  submitLabel?: string
  streaming?: boolean
  onStop?: () => void
  disabled?: boolean
  quotedHighlight?: string | null
  quoteTestId?: string
  onClearQuote?: () => void
  modelValue?: string
  onModelChange?: (next: string) => void
  modelOptions?: ReadonlyArray<SelectOption<string>>
  centered?: boolean
  compact?: boolean
  greetingTitle?: string
  greetingSubtitle?: string
  starterPrompts?: string[]
  onPickStarter?: (prompt: string) => void
  attachActions?: Array<{ label: string; onSelect: () => void }>
  footerLeftSlot?: ReactNode
  className?: string
}) {
  const [plusOpen, setPlusOpen] = useState(false)
  const plusWrapRef = useRef<HTMLDivElement>(null)
  const internalTextareaRef = useRef<HTMLTextAreaElement>(null)
  const resolvedTextareaRef = textareaRef ?? internalTextareaRef

  useEffect(() => {
    if (!value && resolvedTextareaRef.current) {
      resolvedTextareaRef.current.style.height = 'auto'
    }
  }, [value, resolvedTextareaRef])

  useEffect(() => {
    if (!plusOpen) return
    const onPointer = (e: PointerEvent) => {
      if (!plusWrapRef.current?.contains(e.target as Node)) setPlusOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPlusOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [plusOpen])

  const hasFooterLeft = Boolean(
    (attachActions && attachActions.length > 0) ||
      (modelOptions && modelValue && onModelChange) ||
      footerLeftSlot,
  )

  const sendControl =
    streaming && onStop ? (
      <Button variant="danger" size="sm" onClick={onStop} aria-label="Stop generating">
        <Square size={11} /> Stop
      </Button>
    ) : (
      <Button
        variant="primary"
        size="sm"
        className={sendButtonClassName}
        disabled={disabled || (!value.trim() && !quotedHighlight)}
        onClick={() => onSubmit()}
        aria-label={
          submitLabel && !sendAriaLabel.toLowerCase().includes(submitLabel.toLowerCase())
            ? `${sendAriaLabel}: ${submitLabel}`
            : sendAriaLabel
        }
      >
        {submitLabel ? (
          <>
            <span>{submitLabel}</span> <Send size={12} />
          </>
        ) : (
          <Send size={13} />
        )}
      </Button>
    )

  const box = (
    <div
      className={`rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-surface-card)] ${
        compact ? 'p-2.5' : 'p-3.5'
      } shadow-[var(--shadow-sheet)] transition-[border-color,box-shadow] duration-150 focus-within:border-[var(--color-brand)]/75 focus-within:shadow-[0_0_0_3px_rgba(240,164,41,0.12)] ${className}`}
    >
      {quotedHighlight && (
        <div
          data-testid={quoteTestId}
          className="mb-2.5 flex items-start justify-between gap-2 rounded-lg border-l-2 border-[var(--color-brand)] bg-[var(--color-surface-low)] px-3 py-2 text-[13px] text-[var(--color-ink-muted)]"
        >
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

      <div className={!hasFooterLeft && compact ? 'flex items-end gap-2' : ''}>
        <textarea
          ref={resolvedTextareaRef}
          id={textareaId}
          rows={centered ? 3 : compact ? 1 : 2}
          value={value}
          disabled={disabled}
          onChange={(e) => {
            onChange(e.target.value)
            const el = e.target
            el.style.height = 'auto'
            el.style.height = `${Math.min(el.scrollHeight, compact ? 180 : 320)}px`
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (!streaming && (value.trim() || quotedHighlight)) onSubmit()
            }
          }}
          placeholder={placeholder}
          className={`${
            compact ? 'min-h-[38px] text-[14px]' : 'min-h-[54px] text-[15px]'
          } w-full flex-1 resize-none !border-0 !bg-transparent !p-0 leading-relaxed text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:outline-none disabled:opacity-50 ${textareaClassName}`}
        />
        {!hasFooterLeft && compact && <div className="shrink-0">{sendControl}</div>}
      </div>

      {(hasFooterLeft || !compact) && (
        <div className="mt-2 flex items-center justify-between gap-2 pt-1">
          <div className="relative flex flex-wrap items-center gap-2">
            {attachActions && attachActions.length > 0 && (
              <div ref={plusWrapRef} className="relative">
                <button
                  type="button"
                  aria-label="Add context or tool"
                  aria-expanded={plusOpen}
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

          {sendControl}
        </div>
      )}
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
              animationDelay: recording ? `${i * 55}ms` : undefined,
              animationDuration: recording ? `${650 + (i % 4) * 110}ms` : undefined,
              opacity: recording ? 0.9 : 0.35,
            }}
            className={`w-[2.5px] origin-center rounded-full bg-[var(--color-ink)] ${
              recording ? 'animate-wave-bar' : ''
            }`}
          />
        ))}
      </div>

      <span className="font-mono text-[12px] text-[var(--color-ink-muted)] tabular-nums">
        {mm}:{ss}
      </span>
    </div>
  )
}
