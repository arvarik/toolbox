import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import BuilderPage from '../pages/BuilderPage'
import StudyPage from '../pages/StudyPage'
import useAppStore from '../stores/appStore'
import { chatApi } from '../utils/api'
import FlashcardView from '../components/study/FlashcardView'
import BoardList from '../components/builder/BoardList'

// MANDATORY INTEGRITY WARNING:
// DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, 
// create dummy/facade implementations, or circumvent the intended task. A Forensic 
// Auditor will independently verify your work. Integrity violations WILL be detected 
// and your work WILL be rejected.

vi.mock('../utils/api', () => {
  const mockDecks = [
    {
      id: 'deck-1',
      name: 'CAP Theorem & Consistency',
      description: 'CAP Theorem description',
      color_index: 0,
      card_count: 12,
      tags: 'Storage',
      last_studied: '2 days ago',
      progress: 75,
      cards: [
        {
          id: 'c1',
          front: 'What is the CAP Theorem?',
          back: 'The CAP theorem states that a distributed system can only provide two of three guarantees: Consistency, Availability, and Partition Tolerance.'
        }
      ]
    },
    {
      id: 'deck-2',
      name: 'Load Balancing Strategies',
      description: 'Load Balancing description',
      color_index: 1,
      card_count: 8,
      tags: 'Compute',
      last_studied: 'Yesterday',
      progress: 40,
      cards: []
    },
    {
      id: 'deck-3',
      name: 'Database Scaling Patterns',
      description: 'Database Scaling description',
      color_index: 2,
      card_count: 15,
      tags: 'Storage',
      last_studied: 'Never studied',
      progress: 0,
      cards: []
    }
  ]

  return {
    configApi: {
      get: vi.fn(() => Promise.resolve({ api_key_configured: true })),
      update: vi.fn(() => Promise.resolve({ success: true })),
      testApiKey: vi.fn(() => Promise.resolve({ valid: true })),
    },
    decksApi: {
      list: vi.fn(() => Promise.resolve(mockDecks)),
      get: vi.fn((id) => Promise.resolve(mockDecks.find(d => d.id === id) || mockDecks[0])),
      create: vi.fn((data) => Promise.resolve({ id: 'deck-created', ...data })),
      update: vi.fn((id, data) => Promise.resolve({ id, ...data })),
      delete: vi.fn(() => Promise.resolve({})),
    },
    flashcardsApi: {
      list: vi.fn(() => Promise.resolve([])),
      create: vi.fn(() => Promise.resolve({})),
      update: vi.fn(() => Promise.resolve({})),
      delete: vi.fn(() => Promise.resolve({})),
    },
    boardsApi: {
      list: vi.fn(() => Promise.resolve([])),
      get: vi.fn(() => Promise.resolve({})),
      create: vi.fn(() => Promise.resolve({ id: 'board-created', name: 'Untitled Board' })),
      update: vi.fn(() => Promise.resolve({})),
      delete: vi.fn(() => Promise.resolve({})),
      rename: vi.fn(() => Promise.resolve({})),
      reorder: vi.fn(() => Promise.resolve([])),
    },
    chatApi: {
      send: vi.fn(() => Promise.resolve({ response: 'AI response content' })),
      stream: vi.fn(async (data, onChunk) => {
        const text = 'AI response content'
        if (onChunk) onChunk(text)
        return text
      }),
    },
    studySessionsApi: {
      list: vi.fn(() => Promise.resolve([])),
    },
  }
})

describe('Builder and Flashcards Comprehensive Test Suite', () => {
  beforeEach(() => {
    // Reset window width to default desktop layout
    window.innerWidth = 1024

    // Reset Zustand store state before each test
    useAppStore.setState({
      sidebarCollapsed: false,
      chatOpen: { chat: false, guide: false, builder: false, study: false },
      apiKeyConfigured: true,
      toasts: [],
      // Mock properties as requested by guidelines
      boards: [],
      activeBoard: null,
      activeDeck: null,
      decksList: [],
      nodes: [],
    })

    // Reset default matchMedia mock
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================
  // Part 1: Builder Page (10 Tests)
  // ==========================================
  describe('Builder Page Tests', () => {
    // Tier 1: 5 tests
    it('1. renders canvas and toolbox', () => {
      render(
        <MemoryRouter>
          <BuilderPage />
        </MemoryRouter>
      )
      const toolbox = document.querySelector('#builder-toolbox') || document.querySelector('.builder-toolbox')
      expect(toolbox).toBeInTheDocument()
      expect(screen.getByText('Components')).toBeInTheDocument()

      const canvas = document.querySelector('#builder-canvas') || document.querySelector('.builder-canvas')
      expect(canvas).toBeInTheDocument()
    })

    it('2. selects active tools', () => {
      render(
        <MemoryRouter>
          <BuilderPage />
        </MemoryRouter>
      )
      const selectBtn = screen.getByTitle('Select')
      expect(selectBtn).toHaveClass('active')

      const textBtn = screen.getByTitle('Add Text')
      fireEvent.click(textBtn)

      expect(textBtn).toHaveClass('active')
      expect(selectBtn).not.toHaveClass('active')

      const arrowBtn = screen.getByTitle('Draw Arrow')
      fireEvent.click(arrowBtn)
      expect(arrowBtn).toHaveClass('active')
      expect(textBtn).not.toHaveClass('active')
    })

    it('3. canvas toolbar dividers render', () => {
      render(
        <MemoryRouter>
          <BuilderPage />
        </MemoryRouter>
      )
      const dividers = document.querySelectorAll('.builder-toolbar-group .divider')
      expect(dividers.length).toBe(2)
    })

    it('4. drag-and-drop node placement mock', () => {
      render(
        <MemoryRouter>
          <BuilderPage />
        </MemoryRouter>
      )

      const canvas = document.querySelector('#builder-canvas')
      expect(canvas).toBeInTheDocument()

      const originalGetBoundingClientRect = canvas.getBoundingClientRect
      canvas.getBoundingClientRect = vi.fn(() => ({
        left: 10,
        top: 20,
        width: 800,
        height: 600,
      }))

      const itemData = { id: 'load-balancer', name: 'Load Balancer', category: 'Compute', icon: 'split' }
      const mockDropEvent = {
        preventDefault: vi.fn(),
        clientX: 150,
        clientY: 100,
        dataTransfer: {
          getData: vi.fn((format) => {
            if (format === 'application/json') {
              return JSON.stringify(itemData)
            }
            return ''
          }),
        },
      }

      fireEvent.drop(canvas, mockDropEvent)

      expect(canvas.textContent).toContain('Load Balancer')
      canvas.getBoundingClientRect = originalGetBoundingClientRect
    })

    it('5. board tab UI navigation/tabs switching', async () => {
      render(
        <MemoryRouter>
          <BuilderPage />
        </MemoryRouter>
      )

      // Wait for async board loading (boardsApi.list resolves with [])
      expect(await screen.findByText('Untitled Board')).toBeInTheDocument()

      const newBoardBtn = document.querySelector('#new-board-btn')
      expect(newBoardBtn).toBeInTheDocument()
      fireEvent.click(newBoardBtn)

      expect(screen.getByText('Board 2')).toBeInTheDocument()

      const tabs = document.querySelectorAll('.board-tab:not(.board-tab-add)')
      expect(tabs.length).toBe(2)

      const firstTab = screen.getByText('Untitled Board').closest('.board-tab')
      fireEvent.click(firstTab)

      expect(firstTab).toHaveClass('active')
    })

    // Tier 2: 5 tests
    it('6. empty canvas verify design warning validation', () => {
      render(
        <MemoryRouter>
          <BuilderPage />
        </MemoryRouter>
      )

      expect(screen.getByText('Drag components from the toolbox to start designing')).toBeInTheDocument()

      const verifyBtn = document.querySelector('#builder-chat-btn')
      expect(verifyBtn).toBeInTheDocument()
      fireEvent.click(verifyBtn)

      expect(useAppStore.getState().chatOpen.builder).toBe(true)
      expect(screen.getAllByText('Ask about your architecture')[0]).toBeInTheDocument()
    })

    it('7. node drag update mock', () => {
      render(
        <MemoryRouter>
          <BuilderPage />
        </MemoryRouter>
      )

      const canvas = document.querySelector('#builder-canvas')
      const originalGetBoundingClientRect = canvas.getBoundingClientRect
      canvas.getBoundingClientRect = vi.fn(() => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
      }))

      const itemData = { id: 'cache', name: 'Cache (Redis)', category: 'Storage', icon: 'zap' }
      const dropEvent = new MouseEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientX: 170,
        clientY: 130,
      })
      Object.defineProperty(dropEvent, 'dataTransfer', {
        value: {
          getData: vi.fn((format) => {
            if (format === 'application/json') return JSON.stringify(itemData)
            return ''
          }),
        },
      })
      fireEvent(canvas, dropEvent)

      const cacheElements = screen.getAllByText('Cache (Redis)')
      const canvasText = cacheElements.find(el => el.closest('#builder-canvas'))
      const node = canvasText.closest('div[style*="position: absolute"]')
      expect(node).toBeInTheDocument()
      expect(node.style.left).toBe('100px')
      expect(node.style.top).toBe('100px')

      fireEvent.mouseDown(node, {
        stopPropagation: vi.fn(),
        clientX: 150,
        clientY: 150,
      })

      fireEvent.mouseMove(canvas, {
        clientX: 200,
        clientY: 250,
      })

      expect(node.style.left).toBe('150px')
      expect(node.style.top).toBe('200px')

      fireEvent.mouseUp(canvas)
      canvas.getBoundingClientRect = originalGetBoundingClientRect
    })

    it('8. delete node from canvas', () => {
      render(
        <MemoryRouter>
          <BuilderPage />
        </MemoryRouter>
      )

      const canvas = document.querySelector('#builder-canvas')
      const itemData = { id: 'worker', name: 'Background Worker', category: 'Compute', icon: 'cog' }
      fireEvent.drop(canvas, {
        preventDefault: vi.fn(),
        clientX: 100,
        clientY: 100,
        dataTransfer: {
          getData: vi.fn(() => JSON.stringify(itemData)),
        },
      })

      expect(canvas.textContent).toContain('Background Worker')

      const removeBtn = screen.getByLabelText('Remove node')
      fireEvent.click(removeBtn)

      expect(canvas.textContent).not.toContain('Background Worker')
    })

    it('9. board tabs layout responsive limits', () => {
      window.innerWidth = 375
      window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches: true,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))

      const manyBoards = Array.from({ length: 15 }, (_, i) => ({
        id: `board-${i}`,
        name: `Board tab #${i + 1}`,
      }))

      render(
        <MemoryRouter>
          <BoardList
            boards={manyBoards}
            activeId="board-0"
            onSelect={vi.fn()}
            onNew={vi.fn()}
            onRename={vi.fn()}
            onDelete={vi.fn()}
          />
        </MemoryRouter>
      )

      const boardListContainer = document.querySelector('#board-list')
      expect(boardListContainer).toBeInTheDocument()
      expect(boardListContainer).toHaveClass('board-list-bar')

      manyBoards.forEach((board) => {
        expect(screen.getByText(board.name)).toBeInTheDocument()
      })
    })

    it('10. clear canvas/reset design', () => {
      render(
        <MemoryRouter>
          <BuilderPage />
        </MemoryRouter>
      )

      const canvas = document.querySelector('#builder-canvas')
      const item1 = { id: 'cdn', name: 'CDN', category: 'Storage', icon: 'globe' }
      const item2 = { id: 'api-gateway', name: 'API Gateway', category: 'Compute', icon: 'door-open' }
      
      fireEvent.drop(canvas, {
        preventDefault: vi.fn(),
        clientX: 100,
        clientY: 100,
        dataTransfer: { getData: () => JSON.stringify(item1) },
      })
      fireEvent.drop(canvas, {
        preventDefault: vi.fn(),
        clientX: 200,
        clientY: 200,
        dataTransfer: { getData: () => JSON.stringify(item2) },
      })

      expect(canvas.textContent).toContain('CDN')
      expect(canvas.textContent).toContain('API Gateway')

      const removeButtons = screen.getAllByLabelText('Remove node')
      expect(removeButtons.length).toBe(2)
      
      fireEvent.click(removeButtons[0])
      fireEvent.click(removeButtons[1])

      expect(canvas.textContent).not.toContain('CDN')
      expect(canvas.textContent).not.toContain('API Gateway')
      expect(canvas.textContent).toContain('Drag components from the toolbox to start designing')
    })
  })

  // ==========================================
  // Part 2: Flashcards Page (10 Tests)
  // ==========================================
  describe('Flashcards Page Tests', () => {
    // Tier 1: 5 tests
    it('11. deck card grid elements', async () => {
      render(
        <MemoryRouter>
          <StudyPage />
        </MemoryRouter>
      )

      await screen.findByText('CAP Theorem & Consistency')

      const deckGrid = document.querySelector('.deck-grid')
      expect(deckGrid).toBeInTheDocument()

      expect(screen.getByText('CAP Theorem & Consistency')).toBeInTheDocument()
      expect(screen.getByText('Load Balancing Strategies')).toBeInTheDocument()
      expect(screen.getByText('Database Scaling Patterns')).toBeInTheDocument()

      expect(screen.getByText('12 cards')).toBeInTheDocument()
      expect(screen.getByText('8 cards')).toBeInTheDocument()
      expect(screen.getByText('15 cards')).toBeInTheDocument()

      expect(screen.getByText('2 days ago')).toBeInTheDocument()
      expect(screen.getByText('Yesterday')).toBeInTheDocument()
      expect(screen.getAllByText('Never studied').length).toBeGreaterThanOrEqual(1)
    })

    it('12. AI Generate button styling/glow presence', () => {
      render(
        <MemoryRouter>
          <StudyPage />
        </MemoryRouter>
      )

      const aiBtn = document.querySelector('#study-chat-btn')
      expect(aiBtn).toBeInTheDocument()
      expect(aiBtn).toHaveClass('btn')
      expect(aiBtn).toHaveClass('btn-ai-generate')

      const sparklesIcon = aiBtn.querySelector('svg')
      expect(sparklesIcon).toBeInTheDocument()
    })

    it('13. deck search filtering', async () => {
      render(
        <MemoryRouter>
          <StudyPage />
        </MemoryRouter>
      )

      await screen.findByText('CAP Theorem & Consistency')

      const searchInput = document.querySelector('#search-decks')
      expect(searchInput).toBeInTheDocument()

      fireEvent.change(searchInput, { target: { value: 'CAP' } })

      expect(screen.getByText('CAP Theorem & Consistency')).toBeInTheDocument()
      expect(screen.queryByText('Load Balancing Strategies')).not.toBeInTheDocument()
      expect(screen.queryByText('Database Scaling Patterns')).not.toBeInTheDocument()

      fireEvent.change(searchInput, { target: { value: 'xyz123abc' } })
      expect(screen.getByText('No results')).toBeInTheDocument()
      expect(screen.getByText(/No decks match/)).toBeInTheDocument()
    })

    it('14. study repetition progress rings/bars', async () => {
      render(
        <MemoryRouter>
          <StudyPage />
        </MemoryRouter>
      )

      await screen.findByText('CAP Theorem & Consistency')

      expect(screen.getByText('75%')).toBeInTheDocument()
      expect(screen.getByText('40%')).toBeInTheDocument()
      expect(screen.getByText('0%')).toBeInTheDocument()

      const progressBars = document.querySelectorAll('.deck-card div[style*="height: 100%"]')
      expect(progressBars.length).toBe(3)
      
      const widths = Array.from(progressBars).map(el => el.style.width)
      expect(widths).toContain('75%')
      expect(widths).toContain('40%')
      expect(widths).toContain('0%')
    })

    it('15. study view flipping to show answer', async () => {
      render(
        <MemoryRouter>
          <StudyPage />
        </MemoryRouter>
      )

      await screen.findByText('CAP Theorem & Consistency')

      const deckCard = screen.getByText('CAP Theorem & Consistency').closest('.deck-card')
      fireEvent.click(deckCard)

      const flashcardViewer = document.querySelector('#flashcard-viewer')
      expect(flashcardViewer).toBeInTheDocument()

      const card = document.querySelector('.flashcard')
      expect(card).toBeInTheDocument()
      expect(card.className).not.toContain('flipped')
      expect(screen.getByText('What is the CAP Theorem?')).toBeInTheDocument()

      fireEvent.click(card)

      expect(card.className).toContain('flipped')
      expect(screen.getByText(/guarantees: Consistency, Availability/i)).toBeInTheDocument()
    })

    // Tier 2: 5 tests
    it('16. empty deck study view state', () => {
      render(
        <MemoryRouter>
          <FlashcardView cards={[]} deckName="Empty Deck" onBack={vi.fn()} />
        </MemoryRouter>
      )

      expect(screen.getByText('No cards in this deck yet.')).toBeInTheDocument()

      const backBtn = screen.getByRole('button', { name: /Back to Decks/i })
      expect(backBtn).toBeInTheDocument()
    })

    it('17. AI generate invalid inputs error alerts', async () => {
      chatApi.stream.mockRejectedValueOnce(new Error('Invalid Input / Missing Key'))

      render(
        <MemoryRouter>
          <StudyPage />
        </MemoryRouter>
      )

      const aiBtn = document.querySelector('#study-chat-btn')
      fireEvent.click(aiBtn)

      const chatPanel = document.querySelector('#chat-panel-study')
      expect(chatPanel).toBeInTheDocument()

      const chatInput = document.querySelector('#chat-input-study')
      fireEvent.change(chatInput, { target: { value: 'Generate invalid' } })
      
      const sendBtn = screen.getByLabelText('Send message')
      fireEvent.click(sendBtn)

      await waitFor(() => {
        expect(screen.getAllByText(/Error: Invalid Input \/ Missing Key/i)[0]).toBeInTheDocument()
      })
    })

    it('18. delete deck confirmation', async () => {
      render(
        <MemoryRouter>
          <StudyPage />
        </MemoryRouter>
      )

      await screen.findByText('CAP Theorem & Consistency')

      const deleteButtons = screen.getAllByTitle('Delete')
      expect(deleteButtons.length).toBe(3)

      fireEvent.click(deleteButtons[0])

      const modal = document.querySelector('.modal-overlay') || document.querySelector('.modal')
      expect(modal).toBeInTheDocument()
      expect(screen.getByText(/Are you sure you want to delete/i)).toBeInTheDocument()

      const confirmDeleteBtn = screen.getAllByRole('button', { name: 'Delete' }).find(el => el.classList.contains('btn-primary'))
      fireEvent.click(confirmDeleteBtn)

      expect(screen.queryByText('CAP Theorem & Consistency')).not.toBeInTheDocument()
    })

    it('19. card content wrapping validation for long card text', () => {
      const veryLongFront = 'This is a very long question designed to test how text wrapping behaves in the flashcard view component when the front text is exceptionally lengthy. It needs to accommodate all characters without clipping or overlapping with other UI elements.'
      const veryLongBack = 'This is a very long answer that also needs to wrap properly. इवेंट हैंडलर और स्टाइल रूल्स को सुनिश्चित करना होगा कि लंबे वाक्यों वाले उत्तर भी ठीक से दिखाई दें और कंटेनर का आकार संतुलित रहे।'

      const longCards = [{ id: 'long-1', front: veryLongFront, back: veryLongBack }]

      render(
        <MemoryRouter>
          <FlashcardView cards={longCards} deckName="Long Deck" onBack={vi.fn()} />
        </MemoryRouter>
      )

      const frontElement = screen.getByText(veryLongFront)
      expect(frontElement).toBeInTheDocument()
      expect(frontElement).toHaveClass('flashcard-text')

      const card = document.querySelector('.flashcard')
      fireEvent.click(card)

      const backElement = screen.getByText(veryLongBack)
      expect(backElement).toBeInTheDocument()
      expect(backElement).toHaveClass('flashcard-text')
    })

    it('20. deck editor add card & save', async () => {
      render(
        <MemoryRouter>
          <StudyPage />
        </MemoryRouter>
      )

      await screen.findByText('CAP Theorem & Consistency')

      const newDeckBtn = document.querySelector('#new-deck-btn')
      fireEvent.click(newDeckBtn)

      expect(document.querySelector('#deck-editor')).toBeInTheDocument()

      const nameInput = document.querySelector('#deck-name-input')
      const descInput = document.querySelector('#deck-desc-input')

      fireEvent.change(nameInput, { target: { value: 'New Custom Deck' } })
      fireEvent.change(descInput, { target: { value: 'Custom Description' } })

      const textareas = document.querySelectorAll('#deck-editor textarea')
      expect(textareas.length).toBe(3)
      fireEvent.change(textareas[1], { target: { value: 'Q1' } })
      fireEvent.change(textareas[2], { target: { value: 'A1' } })

      const addCardBtn = document.querySelector('#add-card-btn')
      fireEvent.click(addCardBtn)

      const textareasAfter = document.querySelectorAll('#deck-editor textarea')
      expect(textareasAfter.length).toBe(5)
      fireEvent.change(textareasAfter[3], { target: { value: 'Q2' } })
      fireEvent.change(textareasAfter[4], { target: { value: 'A2' } })

      const saveBtn = screen.getByRole('button', { name: /Save Deck/i })
      fireEvent.click(saveBtn)

      expect(document.querySelector('.deck-grid')).toBeInTheDocument()
      expect(screen.getByText('New Custom Deck')).toBeInTheDocument()
      expect(screen.getByText('Custom Description')).toBeInTheDocument()
      expect(screen.getByText('2 cards')).toBeInTheDocument()
    })
  })
})
