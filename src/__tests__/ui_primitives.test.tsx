import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import {
  AnkiCardStack,
  Button,
  DogearCorner,
  DomainGlyph,
  ForgettingCurve,
  HelpHint,
  HighlightableProse,
  InvitingComposer,
  KitAvatar,
  KitLogo,
  NoteUpdateCard,
  NotebookSheet,
  RetrievabilityRing,
  ScrubberSlider,
  SegmentedControl,
  SelectPopover,
  ToastStack,
  VoiceWaveform,
  resolveKitGlyph,
} from '../components/ui'
import DesignSystemPage from '../pages/DesignSystemPage'

describe('UI Primitives Library & DesignSystemPage', () => {
  it('renders KitLogo, KitAvatar, and resolves DomainGlyph without emojis', () => {
    expect(resolveKitGlyph('system-design')).toBe('distributed')
    expect(resolveKitGlyph('🦀 rust')).toBe('rust')
    expect(resolveKitGlyph('euclidean-geometry')).toBe('formal')
    expect(resolveKitGlyph('unknown-topic')).toBe('notebook')

    const { container, rerender } = render(
      <div>
        <KitLogo size={28} variant="tile" state="thinking" />
        <KitAvatar state="done" />
        <DomainGlyph kind="distributed" />
      </div>,
    )
    expect(screen.getByLabelText('Kit — Toolbox')).toBeInTheDocument()
    // Tile logo must NOT blink while thinking
    const tileSvg = screen.getByLabelText('Kit — Toolbox')
    expect(tileSvg.querySelector('.animate-kit-blink')).toBeNull()
    expect(container.querySelector('.animate-kit-thinking')).not.toBeNull()

    rerender(<KitLogo size={18} variant="mono" />)
    expect(screen.getByLabelText('Kit')).toBeInTheDocument()
  })

  it('operates SegmentedControl, SelectPopover, ScrubberSlider (incl. max===min), HelpHint (tap + Escape), RetrievabilityRing, and ToastStack', () => {
    const onTab = vi.fn()
    const onSelect = vi.fn()
    const onSlide = vi.fn()
    const onDismiss = vi.fn()
    const onToastAction = vi.fn()

    render(
      <div>
        <SegmentedControl
          ariaLabel="Mode"
          value="guide"
          onChange={onTab}
          items={[
            { value: 'guide', label: 'Guide' },
            { value: 'map', label: 'Map', badge: 4 },
          ]}
        />
        <SelectPopover
          ariaLabel="Pick model"
          value="sonnet"
          onChange={onSelect}
          options={[
            { value: 'sonnet', label: 'Sonnet 4.6', meta: 'Fast' },
            { value: 'gpt', label: 'GPT-5.4', description: 'Deep reasoning' },
          ]}
        />
        <ScrubberSlider label="Stability" value={10} min={1} max={30} onChange={onSlide} />
        <ScrubberSlider label="ZeroSpan" value={5} min={5} max={5} onChange={onSlide} />
        <HelpHint text="Brief explanation under fourteen words." />
        <RetrievabilityRing retrievability={62} showLabel centerLabel="62" />
        <RetrievabilityRing retrievability={91} showLabel />
        <RetrievabilityRing retrievability={0} locked showLabel />
        <ForgettingCurve stabilityDays={12} projectedStabilityDays={24} />
        <VoiceWaveform recording seconds={65} />
        <ToastStack
          toasts={[
            {
              id: 't1',
              title: 'Saved note',
              detail: 'Core Invariants',
              action: { label: 'Undo', onClick: onToastAction },
            },
          ]}
          onDismiss={onDismiss}
        />
      </div>,
    )

    fireEvent.click(screen.getByRole('tab', { name: /Map/i }))
    expect(onTab).toHaveBeenCalledWith('map')

    fireEvent.click(screen.getByLabelText('Pick model'))
    fireEvent.click(screen.getByRole('option', { name: /GPT-5.4/i }))
    expect(onSelect).toHaveBeenCalledWith('gpt')

    fireEvent.keyDown(screen.getByRole('slider', { name: 'Stability' }), { key: 'ArrowRight' })
    expect(onSlide).toHaveBeenCalledWith(11)

    // Focus + click in same gesture must NOT double-toggle closed
    const hintBtn = screen.getByLabelText('What is this?')
    fireEvent.focus(hintBtn)
    fireEvent.click(hintBtn)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Brief explanation')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onToastAction).toHaveBeenCalled()
    expect(onDismiss).toHaveBeenCalledWith('t1')

    expect(screen.getByText('62%')).toBeInTheDocument()
    expect(screen.getByText('Locked')).toBeInTheDocument()
    expect(screen.getByText('01:05')).toBeInTheDocument()
  })

  it('supports HighlightableProse across inline tags and real mousedown->mouseup->click toolbar sequence', () => {
    const onDogear = vi.fn()
    const onAddHl = vi.fn()
    const onRemoveHl = vi.fn()
    const onMakeCard = vi.fn()
    const onRate = vi.fn()
    const onSubmit = vi.fn()

    const { container } = render(
      <div>
        <NotebookSheet pageKey="p1" dogeared={false} onToggleDogear={onDogear}>
          <HighlightableProse
            contentKey="md-1"
            highlights={[{ id: 'h1', quote: 'Strict quorum overlap', color: 'sage' }]}
            onAddHighlight={onAddHl}
            onRemoveHighlight={onRemoveHl}
            onMakeCard={onMakeCard}
          >
            <p id="prose-target">
              <strong>Strict quorum</strong> overlap prevents CAP anomalies and stale reads.
            </p>
          </HighlightableProse>
        </NotebookSheet>
        <DogearCorner folded onToggle={onDogear} />
        <NoteUpdateCard
          sectionName="Core Invariants"
          summaryBullets={['Added quorum proof']}
          hunks={[{ type: 'add', line: 'W + R > N' }]}
          accepted={false}
          onToggleAccept={vi.fn()}
        />
        <AnkiCardStack
          front="What is W + R > N?"
          back="Strict quorum intersection."
          topicLabel="Replication"
          intervals={{ again: '10m', hard: '3d', good: '10d', easy: '25d' }}
          remainingCount={2}
          boostedFoundations={['Quorums']}
          onRate={onRate}
        />
        <InvitingComposer
          centered
          value="Explain anti-entropy"
          onChange={vi.fn()}
          onSubmit={onSubmit}
          quotedHighlight="quorum overlap"
          starterPrompts={['Prompt 1']}
        />
        <Button variant="primary">Save</Button>
      </div>,
    )

    // Cross-inline-element highlight ('<strong>Strict quorum</strong> overlap') renders <mark> nodes
    expect(container.querySelectorAll('mark[data-hl-id="h1"]').length).toBeGreaterThanOrEqual(2)

    // Select 3-char acronym 'CAP' and simulate real browser mousedown -> mouseup -> click on toolbar
    const proseEl = container.querySelector('#prose-target')!
    const range = document.createRange()
    const tailText = Array.from(proseEl.childNodes).find(
      (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.includes('CAP'),
    )!
    const capIdx = tailText.textContent!.indexOf('CAP')
    range.setStart(tailText, capIdx)
    range.setEnd(tailText, capIdx + 3)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
    fireEvent.mouseUp(proseEl)

    const toolbar = screen.getByTestId('highlight-selection-toolbar')
    const hlBtn = toolbar.querySelector('button')!
    const downEvt = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    hlBtn.dispatchEvent(downEvt)
    expect(downEvt.defaultPrevented).toBe(true)
    // Even if selection collapses before mouseup, stopPropagation keeps toolbar alive for click!
    sel.removeAllRanges()
    fireEvent.mouseUp(hlBtn)
    fireEvent.click(hlBtn)
    expect(onAddHl).toHaveBeenCalledWith('CAP', 'amber', expect.any(String), expect.any(String))

    fireEvent.click(screen.getByLabelText('Dogear this page'))
    expect(onDogear).toHaveBeenCalled()

    fireEvent.click(screen.getByText('Show diff'))
    expect(screen.getByText('W + R > N')).toBeInTheDocument()

    // AnkiCardStack type answer auto-focus & clear on close
    fireEvent.click(screen.getByRole('button', { name: 'Type answer' }))
    const typeInput = screen.getByPlaceholderText(/Jot your recall/i)
    expect(document.activeElement).toBe(typeInput)
    fireEvent.change(typeInput, { target: { value: 'Draft note' } })
    fireEvent.click(screen.getByRole('button', { name: 'Typing on' }))

    fireEvent.click(screen.getByRole('button', { name: /Reveal Answer/i }))
    expect(screen.queryByText(/Draft note/i)).toBeNull()
    expect(screen.getByText('Strict quorum intersection.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Good/i }))
    expect(onRate).toHaveBeenCalledWith('good')

    fireEvent.click(screen.getByRole('button', { name: /Send message: Ask Kit/i }))
    expect(onSubmit).toHaveBeenCalled()
  })

  it('exercises the interactive /design-system Component Library showcase across all specimen groups', () => {
    render(
      <MemoryRouter initialEntries={['/design-system']}>
        <DesignSystemPage />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('design-system-page')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /Tactile Notebook & Precision Hardware Primitives/i }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Test Toast' }))
    expect(screen.getByText('Sample notification')).toBeInTheDocument()

    const kitStateGroup = screen.getByRole('tablist', { name: 'Kit companion state' })
    fireEvent.click(within(kitStateGroup).getByRole('tab', { name: 'Think' }))
    expect(screen.getByText(/Shell tucks gently while thinking/i)).toBeInTheDocument()
    fireEvent.click(within(kitStateGroup).getByRole('tab', { name: 'Done' }))

    fireEvent.click(screen.getByRole('button', { name: 'Next specimen page' }))
    expect(screen.getByText('Sloppy Quorums vs. Linearizability')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Previous specimen page' }))

    const dogearButtons = screen.getAllByRole('button', { name: /dogear/i })
    fireEvent.click(dogearButtons[0])

    const filterTabs = screen.getByRole('tablist', { name: 'Filter component specimens' })
    fireEvent.click(within(filterTabs).getByRole('tab', { name: 'Physics & Inputs' }))
    fireEvent.click(within(filterTabs).getByRole('tab', { name: 'Notebook & Anki' }))
    fireEvent.click(within(filterTabs).getByRole('tab', { name: 'All' }))
  })

  it('guards highlights against mark click-deletion and unrenderable quotes, and resets AnkiCardStack synchronously without blocking focused links/buttons', async () => {
    const fs = await import('node:fs')
    const indexCss = fs.readFileSync('src/index.css', 'utf8')
    expect(indexCss).toContain('.graph-session-overlay')

    const onAddHl = vi.fn()
    const onRemoveHl = vi.fn()
    const onAskKit = vi.fn()

    const { container } = render(
      <HighlightableProse
        highlights={[{ id: 'h-existing', quote: 'Strict quorum', color: 'amber' }]}
        onAddHighlight={onAddHl}
        onRemoveHighlight={onRemoveHl}
        onAskKit={onAskKit}
      >
        <div>
          <p id="p-one">Strict quorum guarantees linearizable reads.</p>
          <p id="p-two"> Anti-entropy repairs divergent replicas.</p>
          <pre id="code-block">const quorum = Math.floor(n / 2) + 1</pre>
        </div>
      </HighlightableProse>,
    )

    // #1: Clicking or drag-selecting inside an existing <mark> never deletes the highlight
    const markEl = container.querySelector('mark[data-hl-id="h-existing"]')!
    expect(markEl).toBeTruthy()
    const markRange = document.createRange()
    markRange.selectNodeContents(markEl)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(markRange)
    fireEvent.mouseUp(markEl)
    fireEvent.click(markEl)
    expect(onRemoveHl).not.toHaveBeenCalled()

    // Toolbar inside existing <mark> still allows Ask Kit, without offering duplicate Highlight button
    const toolbar = screen.getByTestId('highlight-selection-toolbar')
    expect(within(toolbar).queryByText('Highlight')).toBeNull()
    fireEvent.click(within(toolbar).getByText('Ask Kit'))
    expect(onAskKit).toHaveBeenCalledWith('Strict quorum')

    // Explicit remove button in chip tray removes the highlight cleanly
    fireEvent.click(screen.getByLabelText('Remove highlight'))
    expect(onRemoveHl).toHaveBeenCalledWith('h-existing')

    // #5: Selecting inside <pre> or across two paragraphs does not offer Highlight
    const codeEl = container.querySelector('#code-block')!
    const codeRange = document.createRange()
    codeRange.selectNodeContents(codeEl)
    sel.removeAllRanges()
    sel.addRange(codeRange)
    fireEvent.mouseUp(codeEl)
    expect(within(screen.getByTestId('highlight-selection-toolbar')).queryByText('Highlight')).toBeNull()

    const crossRange = document.createRange()
    crossRange.setStart(container.querySelector('#p-one')!.lastChild!, 0)
    crossRange.setEnd(container.querySelector('#p-two')!.firstChild!, 13)
    sel.removeAllRanges()
    sel.addRange(crossRange)
    fireEvent.mouseUp(container.querySelector('#p-two')!)
    expect(within(screen.getByTestId('highlight-selection-toolbar')).queryByText('Highlight')).toBeNull()
    expect(onAddHl).not.toHaveBeenCalled()

    // #3 & #4: Synchronous card reset (zero 1-frame back-face flash) and focused link/button exemption
    const backRendersForCard2: boolean[] = []
    function DeckHarness({ idx }: { idx: number }) {
      const cards = [
        { id: 'c1', front: 'Card 1 front', back: 'Card 1 secret' },
        { id: 'c2', front: 'Card 2 front', back: 'Card 2 secret' },
      ]
      const card = cards[idx]
      function BackProbe() {
        if (card.id === 'c2') backRendersForCard2.push(true)
        return <div>{card.back}</div>
      }
      return (
        <div>
          <a href="/library" data-testid="nav-link">
            Library
          </a>
          <button type="button" data-testid="aux-btn">
            Aux Action
          </button>
          <AnkiCardStack
            cardKey={card.id}
            front={card.front}
            back={card.back}
            backSlot={<BackProbe />}
            topicLabel="Consensus"
            intervals={{ again: '10m', hard: '2d', good: '7d', easy: '21d' }}
            remainingCount={cards.length - idx}
            onRate={vi.fn()}
          />
        </div>
      )
    }

    const { rerender } = render(<DeckHarness idx={0} />)
    const link = screen.getByTestId('nav-link')
    link.focus()
    const enterOnLink = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
    link.dispatchEvent(enterOnLink)
    expect(enterOnLink.defaultPrevented).toBe(false)
    expect(screen.queryByTestId('anki-card-back')).toBeNull()

    const btn = screen.getByTestId('aux-btn')
    btn.focus()
    const spaceOnBtn = new KeyboardEvent('keydown', {
      key: ' ',
      code: 'Space',
      bubbles: true,
      cancelable: true,
    })
    btn.dispatchEvent(spaceOnBtn)
    expect(spaceOnBtn.defaultPrevented).toBe(false)
    expect(screen.queryByTestId('anki-card-back')).toBeNull()

    // Flip Card 1, then advance to Card 2 -> Card 2 backSlot must NOT render even once before reveal
    fireEvent.click(screen.getByTestId('reveal-answer-btn'))
    expect(screen.getByText('Card 1 secret')).toBeInTheDocument()
    rerender(<DeckHarness idx={1} />)
    expect(backRendersForCard2).toEqual([])
    expect(screen.queryByTestId('anki-card-back')).toBeNull()
  })
})
