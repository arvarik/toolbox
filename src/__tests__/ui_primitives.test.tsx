import { fireEvent, render, screen } from '@testing-library/react'
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

    const { rerender } = render(
      <div>
        <KitLogo size={28} variant="tile" state="thinking" />
        <KitAvatar state="done" />
        <DomainGlyph kind="distributed" />
      </div>,
    )
    expect(screen.getByLabelText('Kit — Toolbox')).toBeInTheDocument()
    rerender(<KitLogo size={18} variant="mono" />)
    expect(screen.getByLabelText('Kit')).toBeInTheDocument()
  })

  it('operates SegmentedControl, SelectPopover, ScrubberSlider, HelpHint, and RetrievabilityRing', () => {
    const onTab = vi.fn()
    const onSelect = vi.fn()
    const onSlide = vi.fn()

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
        <HelpHint text="Brief explanation under fourteen words." />
        <RetrievabilityRing retrievability={62} showLabel />
        <RetrievabilityRing retrievability={91} showLabel />
        <RetrievabilityRing retrievability={0} locked showLabel />
        <ForgettingCurve stabilityDays={12} projectedStabilityDays={24} />
        <VoiceWaveform recording seconds={65} />
      </div>,
    )

    fireEvent.click(screen.getByRole('tab', { name: /Map/i }))
    expect(onTab).toHaveBeenCalledWith('map')

    fireEvent.click(screen.getByLabelText('Pick model'))
    fireEvent.click(screen.getByRole('option', { name: /GPT-5.4/i }))
    expect(onSelect).toHaveBeenCalledWith('gpt')

    fireEvent.keyDown(screen.getByRole('slider', { name: 'Stability' }), { key: 'ArrowRight' })
    expect(onSlide).toHaveBeenCalledWith(11)

    fireEvent.click(screen.getByLabelText('What is this?'))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Brief explanation')
    expect(screen.getByText('62%')).toBeInTheDocument()
    expect(screen.getByText('Locked')).toBeInTheDocument()
    expect(screen.getByText('01:05')).toBeInTheDocument()
  })

  it('supports NotebookSheet dogearing, HighlightableProse DOM marks, NoteUpdateCard, AnkiCardStack, and InvitingComposer', () => {
    const onDogear = vi.fn()
    const onRemoveHl = vi.fn()
    const onRate = vi.fn()
    const onSubmit = vi.fn()

    render(
      <div>
        <NotebookSheet pageKey="p1" dogeared={false} onToggleDogear={onDogear}>
          <HighlightableProse
            contentKey="md-1"
            highlights={[{ id: 'h1', quote: 'quorum overlap', color: 'sage' }]}
            onAddHighlight={vi.fn()}
            onRemoveHighlight={onRemoveHl}
          >
            <p>Strict quorum overlap prevents stale reads.</p>
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

    fireEvent.click(screen.getByLabelText('Dogear this page'))
    expect(onDogear).toHaveBeenCalled()

    fireEvent.click(screen.getByText('Show diff'))
    expect(screen.getByText('W + R > N')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Reveal Answer/i }))
    expect(screen.getByText('Strict quorum intersection.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Good/i }))
    expect(onRate).toHaveBeenCalledWith('good')

    fireEvent.click(screen.getByLabelText('Send message'))
    expect(onSubmit).toHaveBeenCalled()
  })

  it('renders the interactive DesignSystemPage showcase cleanly', () => {
    render(
      <MemoryRouter>
        <DesignSystemPage />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('design-system-page')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /Tactile Notebook & Precision Hardware Primitives/i }),
    ).toBeInTheDocument()
  })
})
