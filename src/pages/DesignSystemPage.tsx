import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { HighlightColor } from '../utils/api'
import {
  AnkiCardStack,
  Button,
  DomainGlyph,
  ForgettingCurve,
  HelpHint,
  HighlightableProse,
  InvitingComposer,
  Kbd,
  KitAvatar,
  KitLogo,
  NoteUpdateCard,
  NotebookSheet,
  RetrievabilityRing,
  ScrubberSlider,
  SegmentedControl,
  SelectPopover,
  StageTransition,
  ToastStack,
  VoiceWaveform,
  type DomainGlyphKind,
  type TextbookHighlight,
  type ToastMessage,
} from '../components/ui'

type SectionFilter = 'all' | 'palette' | 'notebook' | 'physics'

const GLYPH_SPECIMENS: Array<{ kind: DomainGlyphKind; name: string }> = [
  { kind: 'distributed', name: 'distributed' },
  { kind: 'gpu', name: 'gpu' },
  { kind: 'bio', name: 'bio' },
  { kind: 'rust', name: 'rust' },
  { kind: 'formal', name: 'formal' },
  { kind: 'notebook', name: 'notebook' },
  { kind: 'flagship', name: 'flagship' },
  { kind: 'challenge', name: 'challenge' },
  { kind: 'fire-wave', name: 'foundations' },
  { kind: 'remediation', name: 'resurface' },
]

const SPECIMEN_PAGES = [
  {
    id: 'chash',
    sectionNum: 'Chapter 1 · Partitioning',
    title: 'Consistent Hashing & Virtual Nodes',
    paragraphs: [
      'A classic modulo ring remaps nearly every key when a storage node joins or leaves. Consistent hashing bounds key movement to O(K/N) by placing both keys and nodes onto a shared 2^32 ring.',
      'Even with K=128 virtual nodes, one hot key K_hot always hashes to a single scalar point on the ring, requiring bounded salted key splitting across R shards.',
    ],
  },
  {
    id: 'quorums',
    sectionNum: 'Chapter 2 · Replication',
    title: 'Sloppy Quorums vs. Linearizability',
    paragraphs: [
      'Strict quorum overlap W + R > N guarantees read-your-writes only when reads and writes intersect on the exact canonical replica set without network partitions.',
      'Hinted handoff trades strict linearizability for write availability, necessitating anti-entropy Merkle trees to reconcile diverged siblings.',
    ],
  },
]

const SAMPLE_CARDS = [
  {
    front: 'Why can virtual nodes (vnodes) never mitigate a single hot partition key K_hot?',
    back: 'Virtual nodes balance key distribution across many distinct keys, but one specific key K_hot hashes deterministically to a single point on the ring. Mitigating K_hot requires application-level salted sub-keys K_hot#0..R-1.',
    topic: 'Distributed Systems · Consistent Hashing',
    intervals: { again: '10m', hard: '4d', good: '14d', easy: '32d' },
    foundations: ['Hash Ring Basics', 'Partition Keys'],
  },
  {
    front: 'Does W + R > N guarantee linearizability in a Dynamo-style quorum store?',
    back: 'No. Concurrent readers can observe new values and old values out of order unless read-repair or consensus serializes concurrent writes before returning.',
    topic: 'Distributed Systems · Quorum Replication',
    intervals: { again: '10m', hard: '6d', good: '18d', easy: '41d' },
    foundations: ['Quorum Intersection'],
  },
]

export default function DesignSystemPage() {
  const [filter, setFilter] = useState<SectionFilter>('all')
  const [kitState, setKitState] = useState<'idle' | 'thinking' | 'done'>('idle')
  const [pageIdx, setPageIdx] = useState<number>(0)
  const [turnDir, setTurnDir] = useState<'next' | 'prev'>('next')
  const [dogeared, setDogeared] = useState<boolean>(true)
  const [highlights, setHighlights] = useState<TextbookHighlight[]>([
    {
      id: 'hl-1',
      pageId: 'chash',
      quote: 'one hot key K_hot always hashes to a single scalar point',
      color: 'amber',
      note: 'Core hot-key invariant',
    },
  ])
  const [updateAccepted, setUpdateAccepted] = useState<boolean>(true)
  const [ankiIdx, setAnkiIdx] = useState<number>(0)
  const [stabilityDays, setStabilityDays] = useState<number>(9.5)
  const [hoverBoost, setHoverBoost] = useState<boolean>(false)
  const [vnodesK, setVnodesK] = useState<number>(128)
  const [modelPick, setModelPick] = useState<string>('claude-sonnet-4-6')
  const [composerVal, setComposerVal] = useState<string>('')
  const [quoted, setQuoted] = useState<string | null>(
    'one hot key K_hot always hashes to a single scalar point',
  )
  const [voiceRec, setVoiceRec] = useState<boolean>(false)
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const toastTimersRef = useRef<Set<number>>(new Set())

  useEffect(() => {
    const timers = toastTimersRef.current
    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer)
      }
      timers.clear()
    }
  }, [])

  const pushToast = (title: string, detail?: string) => {
    const id = `${Date.now()}-${Math.random()}`
    setToasts((prev) => [...prev.slice(-2), { id, title, detail }])
    const timer = window.setTimeout(() => {
      toastTimersRef.current.delete(timer)
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 2600)
    toastTimersRef.current.add(timer)
  }

  const show = (sec: Exclude<SectionFilter, 'all'>) => filter === 'all' || filter === sec
  const samplePage = SPECIMEN_PAGES[pageIdx] ?? SPECIMEN_PAGES[0]
  const currentCard = SAMPLE_CARDS[ankiIdx]

  return (
    <div
      id="design-system-page"
      data-testid="design-system-page"
      className="flex h-full w-full flex-col overflow-hidden bg-[var(--color-surface)] text-[var(--color-ink)]"
    >
      <header className="flex min-h-13 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--color-line)] bg-[var(--color-surface-low)] px-3 py-2 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <KitLogo size={22} />
          <span className="truncate font-serif text-[16px] sm:text-[17px]">
            Toolbox Component Library &amp; Laws of UX
          </span>
        </div>

        <div className="max-w-full overflow-x-auto">
          <SegmentedControl
            size="xs"
            ariaLabel="Filter component specimens"
            value={filter}
            onChange={setFilter}
            items={[
              { value: 'all', label: 'All' },
              { value: 'palette', label: 'Palette & Kit' },
              { value: 'notebook', label: 'Notebook & Anki' },
              { value: 'physics', label: 'Physics & Inputs' },
            ]}
          />
        </div>
      </header>

      <div className="scroll-fade-y flex-1 overflow-y-auto px-3 py-6 sm:px-6 sm:py-8">
        <StageTransition stageKey={filter} className="mx-auto max-w-5xl space-y-12 pb-16">
          <div className="flex flex-col justify-between gap-4 border-b border-[var(--color-line-strong)] pb-7 md:flex-row md:items-end">
            <div className="max-w-2xl">
              <h1 className="font-serif text-3xl tracking-tight text-[var(--color-ink)]">
                Tactile Notebook &amp; Precision Hardware Primitives
              </h1>
              <p className="mt-2 text-[15px] leading-relaxed text-[var(--color-ink-muted)]">
                Warm charcoal &amp; warm paper surfaces with zero halation, strict 4-purpose color,
                living Kit companion states, folded corner dogears, 3-ink highlights, and pure Anki
                cards.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => pushToast('Sample notification', 'Non-blocking toast')}
              >
                Test Toast
              </Button>
              <Button variant="primary" onClick={() => pushToast('Primary action')}>
                Primary Action
              </Button>
            </div>
          </div>

          {show('palette') && (
            <section className="space-y-6">
              <div className="flex items-center justify-between border-b border-[var(--color-line)] pb-2.5">
                <h2 className="font-serif text-[20px]">
                  01 · Surface Ramp, 4-Purpose Color Law &amp; Kit Companion
                </h2>
                <HelpHint
                  align="right"
                  text="Von Restorff Effect: monochrome chrome ensures earned colors stand out immediately."
                />
              </div>

              <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
                <div className="space-y-5 lg:col-span-7">
                  <div className="grid grid-cols-5 gap-2">
                    {[
                      { label: 'Low', bg: 'bg-[var(--color-surface-low)]' },
                      { label: 'Canvas', bg: 'bg-[var(--color-surface)]' },
                      { label: 'Sheet', bg: 'bg-[var(--color-surface-card)]' },
                      { label: 'Control', bg: 'bg-[var(--color-surface-elevated)]' },
                      { label: 'Hover', bg: 'bg-[var(--color-surface-hover)]' },
                    ].map((s) => (
                      <div
                        key={s.label}
                        className={`rounded-lg border border-[var(--color-line-strong)] p-3 text-[12.5px] ${s.bg}`}
                      >
                        <div className="font-medium text-[var(--color-ink)]">{s.label}</div>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 text-[12.5px] sm:grid-cols-4">
                    {[
                      { title: '1 · Kit & CTA', dot: 'var(--color-brand)', note: 'Amber eye & action' },
                      { title: '2 · Note Diffs', dot: 'var(--color-ok)', note: '+Add / −Remove' },
                      { title: '3 · Overdue', dot: 'var(--color-err)', note: 'Memory < 70%' },
                      { title: '4 · Highlights', dot: '#f0a429', note: 'Amber · Sage · Coral' },
                    ].map((c) => (
                      <div
                        key={c.title}
                        className="border-l-2 border-[var(--color-line-strong)] py-1 pl-3"
                      >
                        <div className="flex items-center gap-1.5 font-medium text-[var(--color-ink)]">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: c.dot }}
                          />
                          {c.title}
                        </div>
                        <div className="text-[11.5px] text-[var(--color-ink-faint)]">{c.note}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-4 lg:col-span-5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <KitAvatar size={28} state={kitState} />
                      <div className="text-[13.5px]">
                        <div className="font-medium text-[var(--color-ink)]">
                          Kit Companion ({kitState})
                        </div>
                        <div className="text-[12px] text-[var(--color-ink-muted)]">
                          {kitState === 'thinking'
                            ? 'Shell tucks gently while thinking'
                            : 'Calm stance with subtle amber blink'}
                        </div>
                      </div>
                    </div>

                    <SegmentedControl
                      size="xs"
                      ariaLabel="Kit companion state"
                      value={kitState}
                      onChange={setKitState}
                      items={[
                        { value: 'idle', label: 'Idle' },
                        { value: 'thinking', label: 'Think' },
                        { value: 'done', label: 'Done' },
                      ]}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-5">
                    {GLYPH_SPECIMENS.map((g) => (
                      <div
                        key={g.kind}
                        className="flex items-center gap-1.5 rounded-lg border border-[var(--color-line)] px-2 py-1.5 text-[11px] text-[var(--color-ink-muted)]"
                      >
                        <DomainGlyph kind={g.kind} size={14} className="text-[var(--color-ink)]" />
                        <span className="truncate font-mono">{g.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}

          {show('notebook') && (
            <section className="space-y-6">
              <div className="flex items-center justify-between border-b border-[var(--color-line)] pb-2.5">
                <h2 className="font-serif text-[20px]">
                  02 · Notebook Sheet, Folded Dogear, 3-Ink Highlighter &amp; Note Updates
                </h2>
                <div className="flex items-center gap-1.5 text-[12.5px] text-[var(--color-ink-muted)]">
                  <span>Turn page</span>
                  <button
                    type="button"
                    aria-label="Previous specimen page"
                    disabled={pageIdx === 0}
                    onClick={() => {
                      setTurnDir('prev')
                      setPageIdx((p) => Math.max(0, p - 1))
                    }}
                    className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-[var(--color-line-strong)] bg-[var(--color-surface-card)] disabled:opacity-35"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label="Next specimen page"
                    disabled={pageIdx >= SPECIMEN_PAGES.length - 1}
                    onClick={() => {
                      setTurnDir('next')
                      setPageIdx((p) => Math.min(SPECIMEN_PAGES.length - 1, p + 1))
                    }}
                    className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-[var(--color-line-strong)] bg-[var(--color-surface-card)] disabled:opacity-35"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
                <div className="lg:col-span-7">
                  <NotebookSheet
                    pageKey={samplePage.id}
                    direction={turnDir}
                    dogeared={dogeared}
                    onToggleDogear={() => {
                      setDogeared((d) => !d)
                      pushToast(!dogeared ? 'Dogeared page' : 'Removed dogear')
                    }}
                    className="p-6"
                  >
                    <div className="pr-8">
                      <span className="text-[12px] text-[var(--color-ink-faint)]">
                        {samplePage.sectionNum} · Select any phrase below
                      </span>
                      <h3 className="mt-0.5 font-serif text-[22px] text-[var(--color-ink)]">
                        {samplePage.title}
                      </h3>
                    </div>

                    <div className="mt-4">
                      <HighlightableProse
                        contentKey={samplePage.id}
                        highlights={highlights.filter((h) => h.pageId === samplePage.id)}
                        onAddHighlight={(quote, color: HighlightColor, prefix, suffix) => {
                          setHighlights((prev) => [
                            ...prev,
                            {
                              id: `hl-${Date.now()}`,
                              pageId: samplePage.id,
                              quote,
                              prefix,
                              suffix,
                              color,
                              note: '',
                            },
                          ])
                          pushToast(`Added ${color} highlight`)
                        }}
                        onRemoveHighlight={(id) =>
                          setHighlights((prev) => prev.filter((h) => h.id !== id))
                        }
                        onMakeCard={(q) => pushToast('Created Anki card', q.slice(0, 36))}
                        onAskKit={(q) => {
                          setQuoted(q)
                          pushToast('Docked quote into composer')
                        }}
                      >
                        <div className="space-y-4">
                          {samplePage.paragraphs.map((p, idx) => (
                            <p key={idx}>{p}</p>
                          ))}
                        </div>
                      </HighlightableProse>
                    </div>
                  </NotebookSheet>
                </div>

                <div className="space-y-6 lg:col-span-5">
                  <div>
                    <div className="mb-2 text-[12.5px] font-medium text-[var(--color-ink-muted)]">
                      Clean Summary Update (with optional diff)
                    </div>
                    <NoteUpdateCard
                      sectionName="Failure Modes & Hot Keys"
                      summaryBullets={[
                        'Bounded salted sub-keys split hot writes across R distinct partitions.',
                        'Read fan-out aggregates partial counters in parallel.',
                      ]}
                      hunks={[
                        { type: 'ctx', line: 'Virtual nodes balance uniform keyspace load.' },
                        { type: 'del', line: 'Add more vnodes when a single user key spikes.' },
                        { type: 'add', line: 'Salt hot keys K#0..R-1 to spread single-key load.' },
                      ]}
                      accepted={updateAccepted}
                      onToggleAccept={() => setUpdateAccepted((a) => !a)}
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4">
                <div className="mb-4 flex items-center justify-between">
                  <span className="font-serif text-[18px]">
                    Anki Card Stack (Thinning Deck Edges · Pure 4-Button Grading)
                  </span>
                  <span className="text-[12.5px] text-[var(--color-ink-faint)]">
                    Press <Kbd>Space</Kbd> then <Kbd>1</Kbd>–<Kbd>4</Kbd>
                  </span>
                </div>
                <AnkiCardStack
                  cardKey={String(ankiIdx)}
                  front={currentCard?.front ?? ''}
                  back={currentCard?.back ?? ''}
                  topicLabel={currentCard?.topic ?? 'Complete'}
                  intervals={
                    currentCard?.intervals ?? {
                      again: '10m',
                      hard: '6d',
                      good: '18d',
                      easy: '38d',
                    }
                  }
                  remainingCount={Math.max(0, SAMPLE_CARDS.length - ankiIdx)}
                  boostedFoundations={currentCard?.foundations}
                  onRate={(g) => {
                    pushToast(`Rated ${g}`)
                    setAnkiIdx((i) => i + 1)
                  }}
                  onReset={() => setAnkiIdx(0)}
                />
              </div>
            </section>
          )}

          {show('physics') && (
            <section className="space-y-6">
              <div className="flex items-center justify-between border-b border-[var(--color-line)] pb-2.5">
                <h2 className="font-serif text-[20px]">
                  03 · Magnetic Crosshair Curves, Elastic Scrubbers &amp; Inviting Composer
                </h2>
                <HelpHint
                  align="right"
                  text="Fitts's Law & hardware craft: immediate cursor tracking and generous input targets."
                />
              </div>

              <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
                <div className="space-y-5 lg:col-span-5">
                  <div className="flex items-center justify-between border-b border-[var(--color-line)] pb-3">
                    <RetrievabilityRing retrievability={92} showLabel />
                    <RetrievabilityRing retrievability={78} showLabel />
                    <RetrievabilityRing retrievability={64} showLabel />
                    <RetrievabilityRing retrievability={0} locked showLabel />
                  </div>

                  <ForgettingCurve
                    stabilityDays={stabilityDays}
                    projectedStabilityDays={hoverBoost ? stabilityDays * 2.3 : null}
                  />

                  <div className="flex items-center justify-between">
                    <ScrubberSlider
                      label="Stability (days)"
                      value={stabilityDays}
                      min={2}
                      max={30}
                      step={0.5}
                      ticks={[7, 14, 21]}
                      formatValue={(v) => `${v}d`}
                      onChange={setStabilityDays}
                      className="flex-1 pr-4"
                    />
                    <Button
                      size="xs"
                      variant="secondary"
                      onMouseEnter={() => setHoverBoost(true)}
                      onMouseLeave={() => setHoverBoost(false)}
                      onClick={() => setHoverBoost((b) => !b)}
                    >
                      Preview Good
                    </Button>
                  </div>

                  <ScrubberSlider
                    label="Virtual nodes per host (K)"
                    value={vnodesK}
                    min={16}
                    max={512}
                    step={16}
                    ticks={[64, 128, 256]}
                    formatValue={(v) => `${v} vnodes`}
                    onChange={setVnodesK}
                  />

                  <div className="flex items-center gap-2">
                    <VoiceWaveform recording={voiceRec} seconds={14} className="flex-1" />
                    <Button
                      size="sm"
                      variant={voiceRec ? 'danger' : 'secondary'}
                      onClick={() => setVoiceRec((r) => !r)}
                    >
                      {voiceRec ? 'Stop' : 'Mic'}
                    </Button>
                  </div>
                </div>

                <div className="space-y-4 lg:col-span-7">
                  <div className="flex items-center justify-between">
                    <span className="text-[12.5px] text-[var(--color-ink-muted)]">
                      Floating Model Picker + Inviting “Ask Kit” Composer
                    </span>
                    <SelectPopover
                      size="xs"
                      align="right"
                      ariaLabel="Specimen model selector"
                      value={modelPick}
                      onChange={setModelPick}
                      options={[
                        {
                          value: 'claude-sonnet-4-6',
                          label: 'Claude Sonnet 4.6',
                          meta: 'Fast',
                          description: 'Socratic tutoring & guide updates',
                        },
                        {
                          value: 'gpt-5.4',
                          label: 'GPT-5.4',
                          meta: 'Reasoning',
                          description: 'Deep proofs & architecture critiques',
                        },
                      ]}
                    />
                  </div>

                  <InvitingComposer
                    centered
                    value={composerVal}
                    onChange={setComposerVal}
                    quotedHighlight={quoted}
                    onClearQuote={() => setQuoted(null)}
                    modelValue={modelPick}
                    onModelChange={setModelPick}
                    modelOptions={[
                      { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
                      { value: 'gpt-5.4', label: 'GPT-5.4' },
                    ]}
                    starterPrompts={[
                      'Why does K=128 still leave hot keys vulnerable?',
                      'Quiz me on quorum intersection edge cases',
                      'Compare Merkle anti-entropy vs read repair',
                    ]}
                    onPickStarter={(sp) => setComposerVal(sp)}
                    onSubmit={(txt) => {
                      pushToast('Sent to Kit', (txt ?? composerVal) || 'Message sent')
                      setComposerVal('')
                    }}
                  />
                </div>
              </div>
            </section>
          )}
        </StageTransition>
      </div>

      <ToastStack
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
      />
    </div>
  )
}
