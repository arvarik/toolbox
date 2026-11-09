import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SYSTEM_DESIGN_KIT_SKELETON } from '../../shared/kits/systemDesignKit'
import { AuthGate } from '../components/auth/AuthGate'
import Layout from '../components/layout/Layout'
import Sidebar from '../components/layout/Sidebar'
import useAppStore from '../stores/appStore'
import useCommitStore from '../stores/useCommitStore'
import useKitStore from '../stores/useKitStore'
import type { KitDetailItem } from '../stores/useKitStore'

const makeConceptKit = (slug: string): KitDetailItem => {
  const capabilities = {
    ...SYSTEM_DESIGN_KIT_SKELETON.capabilities,
    canvas: 'concept' as const,
    calculator: false,
  }
  return {
    id: `id-${slug}`,
    slug,
    name: 'Rust Ownership',
    description: 'Borrow checker & lifetimes',
    icon: '🦀',
    color: '#f97316',
    status: 'ready',
    statusDetail: null,
    forkedFromSharedId: null,
    forkedVersion: null,
    upstreamSlug: null,
    upstreamLatestVersion: null,
    hasUpstreamUpdate: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    lastOpenedAt: null,
    pillarCount: 1,
    topicCount: 1,
    nodeCount: 1,
    capabilities,
    deckCount: 0,
    cardCount: 0,
    dueCount: 0,
    newCount: 0,
    reviewedCount: 0,
    masteryPercent: 0,
    guideFilledCount: 0,
    guideTotalCount: 1,
    archivedNotesCount: 0,
    drillCount: 0,
    skeleton: {
      ...SYSTEM_DESIGN_KIT_SKELETON,
      identity: { ...SYSTEM_DESIGN_KIT_SKELETON.identity, slug, name: 'Rust Ownership' },
      capabilities,
    },
  }
}

describe('Sidebar Navigation & Mobile Shell', () => {
  const setViewport = (width: number) => {
    window.innerWidth = width
    window.matchMedia = vi.fn().mockImplementation((query: string) => {
      const isMobile = width < 768
      const matches =
        query.includes('max-width') || query.includes('768') || query.includes('640')
          ? isMobile
          : !isMobile
      return {
        matches,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }
    })
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
  }

  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ groups: [], kits: [], authRequired: false, user: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    useAppStore.getState().resetWorkspaceState()
    useCommitStore.getState().closeCompletely()
    useKitStore.setState({ kits: [], activeKitSlug: null, activeKit: null, kitCache: {} })
    setViewport(1024)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Desktop Sidebar', () => {
    it('renders application title and workspace/study navigation links with correct hrefs', () => {
      render(
        <MemoryRouter initialEntries={['/builder']}>
          <Sidebar />
        </MemoryRouter>,
      )

      const title = screen.getByText('Toolbox')
      expect(title.className).toContain('sidebar-title')

      const expectedLinks: Array<[RegExp, string]> = [
        [/^library$/i, '/'],
        [/guide/i, '/guide'],
        [/builder/i, '/builder'],
        [/flashcards/i, '/study'],
        [/settings/i, '/settings'],
      ]
      for (const [label, href] of expectedLinks) {
        expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href)
      }

      expect(screen.getByRole('link', { name: /builder/i }).className).toContain('active')
      expect(screen.getByRole('link', { name: /guide/i }).className).not.toContain('active')
      expect(screen.getByText('Flashcards').className).toContain('sidebar-link-label')
    })

    it('adapts study links to /k/:slug routes and Kit capabilities (concept canvas, no calculator)', () => {
      const kit = makeConceptKit('rust-kit')
      useKitStore.getState().setActiveKitDirect(kit)

      render(
        <MemoryRouter initialEntries={['/k/rust-kit/canvas']}>
          <Sidebar />
        </MemoryRouter>,
      )

      expect(screen.getByRole('link', { name: /^path$/i })).toHaveAttribute('href', '/k/rust-kit')
      const conceptLink = screen.getByRole('link', { name: /concept map/i })
      expect(conceptLink).toHaveAttribute('href', '/k/rust-kit/canvas')
      expect(conceptLink.className).toContain('active')
      expect(screen.queryByRole('link', { name: /calculator/i })).not.toBeInTheDocument()
    })

    it('cycles collapse state, CSS class, and dynamic aria-label cleanly', () => {
      render(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>,
      )

      const sidebar = document.querySelector('#app-sidebar')
      const toggleBtn = screen.getByRole('button', { name: 'Collapse sidebar' })
      expect(toggleBtn.className).toContain('sidebar-collapse-btn')

      fireEvent.click(toggleBtn)
      expect(useAppStore.getState().sidebarCollapsed).toBe(true)
      expect(sidebar?.className).toContain('collapsed')
      expect(toggleBtn).toHaveAttribute('aria-label', 'Expand sidebar')

      fireEvent.click(toggleBtn)
      expect(useAppStore.getState().sidebarCollapsed).toBe(false)
      expect(sidebar?.className).not.toContain('collapsed')
      expect(toggleBtn).toHaveAttribute('aria-label', 'Collapse sidebar')
    })

    it('toggles light/dark theme via theme-toggle button', () => {
      render(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>,
      )

      const initial = useAppStore.getState().theme
      fireEvent.click(screen.getByTestId('theme-toggle'))
      expect(useAppStore.getState().theme).toBe(initial === 'dark' ? 'light' : 'dark')
    })

    it('purges workspace, commit, and kit stores on Sign out', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.endsWith('/api/auth/status')) {
          return new Response(
            JSON.stringify({
              setupRequired: false,
              authRequired: true,
              authenticated: true,
              user: { id: 'u1', username: 'dev', mustChangePassword: false },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return new Response(JSON.stringify({ ok: true, groups: [], kits: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })

      useAppStore.setState({
        nodes: [{ id: 'n1', data: { name: 'Secret Node' } }],
        apiKeyConfigured: true,
      })
      useCommitStore.getState().startAnalysis([{ role: 'user', content: 'Secret note' }], null)
      useKitStore.getState().setActiveKitDirect(makeConceptKit('private-kit'))

      render(
        <AuthGate>
          <MemoryRouter>
            <Sidebar />
          </MemoryRouter>
        </AuthGate>,
      )

      const signOutBtn = await screen.findByRole('button', { name: 'Sign out dev' })
      fireEvent.click(signOutBtn)

      expect(useAppStore.getState().nodes).toEqual([])
      expect(useAppStore.getState().apiKeyConfigured).toBe(false)
      expect(useCommitStore.getState().isOpen).toBe(false)
      expect(useCommitStore.getState().messages).toEqual([])
      expect(useKitStore.getState().activeKitSlug).toBeNull()
      expect(useKitStore.getState().kits).toEqual([])
    })
  })

  describe('Mobile Responsiveness & Keyboard Shortcuts', () => {
    it('hides desktop sidebar, opens/closes mobile drawer with active link, and updates on resize', () => {
      setViewport(390)
      render(
        <MemoryRouter initialEntries={['/study']}>
          <Layout />
        </MemoryRouter>,
      )

      expect(document.querySelector('#app-sidebar')?.className).toContain('hidden-mobile')
      const menuBtn = screen.getByRole('button', { name: 'Toggle menu' })
      fireEvent.click(menuBtn)

      const drawer = screen.getByRole('navigation', { name: 'mobile' })
      expect(drawer.querySelector('[href="/study"]')?.className).toContain('active')
      expect(drawer.querySelector('[href="/guide"]')?.className).not.toContain('active')

      fireEvent.click(screen.getByRole('button', { name: 'Close menu' }))
      expect(screen.queryByRole('navigation', { name: 'mobile' })).not.toBeInTheDocument()

      setViewport(1024)
      expect(document.querySelector('#app-sidebar')?.className).not.toContain('hidden-mobile')
      expect(screen.queryByRole('button', { name: 'Toggle menu' })).not.toBeInTheDocument()
    })

    it('renders MobileHeader title and Plan button accurately on /k/:slug routes', () => {
      setViewport(390)
      render(
        <MemoryRouter initialEntries={['/k/rust-kit/chat']}>
          <Layout />
        </MemoryRouter>,
      )

      expect(document.querySelector('.mobile-header-title')?.textContent).toBe('Chat')
      expect(screen.getByRole('button', { name: /plan/i })).toBeInTheDocument()
    })

    it('renders fullscreen mobile ChatPanel and closes cleanly', () => {
      setViewport(390)
      useAppStore.setState({ chatOpen: { guide: true, builder: false, study: false, chat: false } })

      render(
        <MemoryRouter initialEntries={['/guide']}>
          <Layout />
        </MemoryRouter>,
      )

      const chatPanel = screen.getByTestId('chat-panel-container')
      expect(chatPanel.className).toContain('mobile-fullscreen')

      fireEvent.click(screen.getByRole('button', { name: 'Close chat' }))
      expect(useAppStore.getState().chatOpen.guide).toBe(false)
      expect(screen.queryByTestId('chat-panel-container')).not.toBeInTheDocument()
    })

    it('toggles SearchDialog via ⌘/ without corrupting boolean searchOpen state and opens Shortcuts on ⌘?', () => {
      render(
        <MemoryRouter initialEntries={['/guide']}>
          <Layout />
        </MemoryRouter>,
      )

      expect(useAppStore.getState().searchOpen).toBe(false)
      fireEvent.keyDown(window, { key: '/', metaKey: true })
      expect(typeof useAppStore.getState().searchOpen).toBe('boolean')
      expect(useAppStore.getState().searchOpen).toBe(true)

      fireEvent.keyDown(window, { key: '/', metaKey: true })
      expect(useAppStore.getState().searchOpen).toBe(false)

      fireEvent.keyDown(window, { key: '?', metaKey: true, shiftKey: true })
      expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument()
    })
  })
})
