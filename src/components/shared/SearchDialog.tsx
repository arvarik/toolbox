import { useState, useEffect, useMemo, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import {
  Search,
  X,
  ArrowRight,
  Compass,
  MessageSquare,
  BookOpen,
  Target,
  PenTool,
  GraduationCap,
  BrainCircuit,
  Shuffle,
  Waypoints,
  Calculator,
  FolderKanban,
  Flame,
  Globe,
  Blocks,
  Settings,
  FileText,
  Layers,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useNavigate } from 'react-router'
import { searchApi } from '../../utils/api'
import { useActiveKit, useKitRoutePrefix } from '../../stores/useKitStore'
import { Kbd } from '../ui/Controls'

interface SearchResultItem {
  id: string
  name: string
  pillarName: string
  icon: LucideIcon
  path: string
  shortcut?: string
}

export interface SearchDialogProps {
  open: boolean
  onClose: () => void
}

/**
 * SearchDialog — Linear/Codex command palette (`⌘/`) for active Kit topics,
 * notes, flashcards, boards, and global navigation.
 */
export default function SearchDialog({ open, onClose }: SearchDialogProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const navigate = useNavigate()
  const { pillars, capabilities } = useActiveKit()
  const prefix = useKitRoutePrefix()

  const quickCommands = useMemo<SearchResultItem[]>(() => {
    const inKit = Boolean(prefix)
    const items: SearchResultItem[] = [
      {
        id: 'cmd-library',
        name: 'Library',
        pillarName: 'Workspace',
        icon: FolderKanban,
        path: '/',
      },
      {
        id: 'cmd-review',
        name: 'Daily Review',
        pillarName: 'Workspace',
        icon: Flame,
        path: '/review',
      },
      {
        id: 'cmd-shared',
        name: 'Shared Kits',
        pillarName: 'Workspace',
        icon: Globe,
        path: '/shared',
      },
    ]

    if (inKit) {
      items.push({
        id: 'cmd-path',
        name: 'Path',
        pillarName: 'Study',
        icon: Compass,
        path: prefix,
      })
    }

    items.push(
      {
        id: 'cmd-chat',
        name: 'Learn',
        pillarName: 'Study',
        icon: MessageSquare,
        path: `${prefix}/chat`,
        shortcut: '⌘1',
      },
      {
        id: 'cmd-guide',
        name: 'Guide',
        pillarName: 'Study',
        icon: BookOpen,
        path: `${prefix}/guide`,
        shortcut: '⌘2',
      },
      {
        id: 'cmd-drills',
        name: 'Drills',
        pillarName: 'Study',
        icon: Target,
        path: `${prefix}/drills`,
      },
    )

    if (!inKit || capabilities.canvas !== 'none') {
      const isConcept = inKit && capabilities.canvas === 'concept'
      items.push({
        id: 'cmd-builder',
        name: isConcept ? 'Concept Map' : 'Architecture',
        pillarName: 'Study',
        icon: PenTool,
        path: isConcept ? `${prefix}/canvas` : `${prefix}/builder`,
        shortcut: '⌘3',
      })
    }

    items.push(
      {
        id: 'cmd-study',
        name: 'Flashcards',
        pillarName: 'Study',
        icon: GraduationCap,
        path: `${prefix}/study`,
        shortcut: '⌘4',
      },
      {
        id: 'cmd-feynman',
        name: 'Feynman',
        pillarName: 'Study',
        icon: BrainCircuit,
        path: `${prefix}/feynman`,
        shortcut: '⌘5',
      },
      {
        id: 'cmd-interleaved',
        name: 'Interleaved',
        pillarName: 'Study',
        icon: Shuffle,
        path: `${prefix}/interleaved`,
        shortcut: '⌘6',
      },
      {
        id: 'cmd-graph',
        name: 'Graph',
        pillarName: 'Study',
        icon: Waypoints,
        path: `${prefix}/graph`,
        shortcut: '⌘7',
      },
    )

    if (!inKit || capabilities.calculator !== false) {
      items.push({
        id: 'cmd-calculator',
        name: 'Calculator',
        pillarName: 'Study',
        icon: Calculator,
        path: `${prefix}/calculator`,
        shortcut: '⌘8',
      })
    }

    items.push(
      {
        id: 'cmd-design-system',
        name: 'Component Library',
        pillarName: 'System',
        icon: Blocks,
        path: '/design-system',
      },
      {
        id: 'cmd-settings',
        name: 'Settings',
        pillarName: 'System',
        icon: Settings,
        path: '/settings',
        shortcut: '⌘,',
      },
    )

    return items
  }, [prefix, capabilities.canvas, capabilities.calculator])

  const defaultTopics = useMemo<SearchResultItem[]>(
    () => [
      ...quickCommands,
      ...pillars.flatMap((pillar) =>
        pillar.topics.map((topic) => ({
          id: `topic-${pillar.id}-${topic.id}`,
          name: topic.name,
          pillarName: pillar.shortName,
          icon: BookOpen,
          path: `${prefix}/guide/${pillar.id}/${topic.id}`,
        })),
      ),
    ],
    [quickCommands, pillars, prefix],
  )

  const [results, setResults] = useState<SearchResultItem[]>(defaultTopics)

  useEffect(() => {
    if (!open) return
    if (!query.trim()) {
      setResults(defaultTopics)
      return
    }

    let cancelled = false
    const q = query.trim().toLowerCase()
    const matchingLocal = defaultTopics.filter(
      (c) => c.name.toLowerCase().includes(q) || c.pillarName.toLowerCase().includes(q),
    )

    const fetchSearch = async () => {
      try {
        const res = await searchApi.query(query)
        if (cancelled) return
        const combined: SearchResultItem[] = [...matchingLocal]
        const canvasPath =
          prefix && capabilities.canvas === 'concept'
            ? `${prefix}/canvas`
            : `${prefix}/builder`

        res.guideContent.forEach((item) => {
          combined.push({
            id: `guide-${item.pillar_id}-${item.topic_id}-${item.section_id}`,
            name: item.section_id.replace(/-/g, ' '),
            pillarName: `Guide Note · ${item.topic_id}`,
            icon: FileText,
            path: `${prefix}/guide/${item.pillar_id}/${item.topic_id}`,
          })
        })

        res.flashcards.forEach((item) => {
          combined.push({
            id: `fc-${item.id}`,
            name: item.front,
            pillarName: `Flashcard · Deck ${item.deck_id}`,
            icon: GraduationCap,
            path: `${prefix}/study`,
          })
        })

        res.boards.forEach((item) => {
          combined.push({
            id: `board-${item.id}`,
            name: item.name,
            pillarName: capabilities.canvas === 'concept' ? 'Concept Map' : 'Architecture',
            icon: PenTool,
            path: canvasPath,
          })
        })

        res.decks.forEach((item) => {
          combined.push({
            id: `deck-${item.id}`,
            name: item.name,
            pillarName: 'Deck',
            icon: Layers,
            path: `${prefix}/study`,
          })
        })

        setResults(combined)
        setSelectedIndex(0)
      } catch (err) {
        if (!cancelled) {
          console.error('Search failed:', err)
        }
      }
    }

    const timer = setTimeout(() => void fetchSearch(), 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, query, defaultTopics, prefix, capabilities.canvas])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelectedIndex(0)
    const timer = setTimeout(() => {
      inputRef.current?.focus()
    }, 50)
    return () => clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onGlobalKeyDown)
    return () => window.removeEventListener('keydown', onGlobalKeyDown)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    itemRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [open, selectedIndex])

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.min(prev + 1, Math.max(0, results.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      e.preventDefault()
      navigate(results[selectedIndex].path)
      onClose()
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[400] flex items-start justify-center bg-black/50 pl-[max(0.75rem,env(safe-area-inset-left,0px))] pr-[max(0.75rem,env(safe-area-inset-right,0px))] pt-[max(0.75rem,env(safe-area-inset-top,0px))] backdrop-blur-[2px] sm:pl-[max(1rem,env(safe-area-inset-left,0px))] sm:pr-[max(1rem,env(safe-area-inset-right,0px))] sm:pt-[13vh]"
      onClick={onClose}
      id="search-dialog"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="animate-popover-enter flex max-h-[calc(100dvh-1.5rem-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px))] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-surface-card)] text-[var(--color-ink)] shadow-[var(--shadow-float)]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex shrink-0 items-center gap-2.5 border-b border-[var(--color-line)] px-3.5 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
          <Search size={16} className="shrink-0 text-[var(--color-ink-faint)]" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search topics, notes, flashcards..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedIndex(0)
            }}
            className="min-w-0 flex-1 border-0 bg-transparent text-[16px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:outline-none sm:text-[14.5px]"
          />
          <Kbd className="hidden sm:inline-flex">⌘/</Kbd>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-ink)] sm:h-7 sm:w-7"
          >
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[58dvh] flex-1 overflow-y-auto overscroll-contain p-1.5 sm:max-h-[360px]">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px] text-[var(--color-ink-muted)]">
              No matching results found.
            </div>
          ) : (
            results.map((topic, i) => {
              const Icon = topic.icon
              const isSelected = i === selectedIndex
              return (
                <button
                  type="button"
                  key={topic.id}
                  ref={(el) => {
                    itemRefs.current[i] = el
                  }}
                  className={`search-result-item min-h-[44px] sm:min-h-0${isSelected ? ' selected' : ''}`}
                  style={
                    isSelected
                      ? {
                          background: 'var(--color-surface-elevated)',
                          boxShadow: 'var(--shadow-hairline)',
                        }
                      : undefined
                  }
                  onClick={() => {
                    navigate(topic.path)
                    onClose()
                  }}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--color-line)] bg-[var(--color-surface-low)] text-[var(--color-ink-muted)]">
                    <Icon size={14} strokeWidth={1.6} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="search-result-name truncate text-[13.5px] font-medium text-[var(--color-ink)]">
                      {topic.name}
                    </div>
                    <div className="search-result-pillar truncate text-[11.5px] text-[var(--color-ink-muted)]">
                      {topic.pillarName}
                    </div>
                  </div>
                  {topic.shortcut && <Kbd className="mr-1 hidden sm:inline-flex">{topic.shortcut}</Kbd>}
                  <ArrowRight
                    size={13}
                    className={`shrink-0 transition-opacity ${
                      isSelected
                        ? 'text-[var(--color-ink)] opacity-100'
                        : 'text-[var(--color-ink-faint)] opacity-45'
                    }`}
                  />
                </button>
              )
            })
          )}
        </div>

        <div className="hidden items-center justify-between gap-4 border-t border-[var(--color-line)] bg-[var(--color-surface-low)] px-4 py-2 text-[11.5px] text-[var(--color-ink-muted)] sm:flex">
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              <span>Navigate</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Kbd>↵</Kbd>
              <span>Open</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Kbd>Esc</Kbd>
              <span>Close</span>
            </span>
          </div>
          <span className="hidden font-mono text-[10.5px] text-[var(--color-ink-faint)] sm:inline">
            {results.length} {results.length === 1 ? 'item' : 'items'}
          </span>
        </div>
      </div>
    </div>
  )
}
