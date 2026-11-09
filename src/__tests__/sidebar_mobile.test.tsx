import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthGate } from '../components/auth/AuthGate'
import Layout from '../components/layout/Layout'
import Sidebar, { buildStudyNavItems } from '../components/layout/Sidebar'
import useAppStore from '../stores/appStore'
import useCommitStore from '../stores/useCommitStore'
import useKitStore from '../stores/useKitStore'
import { makeTestKit, resetKitStore } from './testHelpers'

describe('Sidebar Navigation & Mobile Shell', () => {
  const applyViewport = (width: number) => {
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

  const renderSettled = async (ui: ReactNode) => {
    await act(async () => {
      render(ui)
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
    resetKitStore()
    applyViewport(1024)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('wires buildStudyNavItems and adapts Sidebar study links to /k/:slug capabilities, collapse cycle, and theme toggle', async () => {
    const kitItems = buildStudyNavItems('/k/rust-kit', { canvas: 'concept', calculator: false })
    expect(kitItems[0]).toMatchObject({ to: '/k/rust-kit', label: 'Path', exact: true })
    expect(kitItems.some((i) => i.to === '/k/rust-kit/drills' && i.label === 'Drills')).toBe(true)

    const legacyItems = buildStudyNavItems('', { canvas: 'architecture', calculator: true })
    expect(legacyItems.some((i) => i.label === 'Path')).toBe(false)
    expect(legacyItems.some((i) => i.to === '/drills' && i.label === 'Drills')).toBe(true)

    const kit = makeTestKit({
      slug: 'rust-kit',
      name: 'Rust Ownership',
      capabilities: { canvas: 'concept', calculator: false },
    })
    useKitStore.getState().setActiveKitDirect(kit)

    await renderSettled(
      <MemoryRouter initialEntries={['/k/rust-kit/canvas']}>
        <Sidebar />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: /^path$/i })).toHaveAttribute('href', '/k/rust-kit')
    const conceptLink = screen.getByRole('link', { name: /concept map/i })
    expect(conceptLink).toHaveAttribute('href', '/k/rust-kit/canvas')
    expect(conceptLink.className).toContain('active')
    expect(screen.queryByRole('link', { name: /calculator/i })).not.toBeInTheDocument()

    const sidebar = document.querySelector('#app-sidebar')
    const toggleBtn = screen.getByRole('button', { name: 'Collapse sidebar' })
    fireEvent.click(toggleBtn)
    expect(useAppStore.getState().sidebarCollapsed).toBe(true)
    expect(sidebar?.className).toContain('collapsed')
    expect(toggleBtn).toHaveAttribute('aria-label', 'Expand sidebar')

    fireEvent.click(toggleBtn)
    expect(useAppStore.getState().sidebarCollapsed).toBe(false)
    expect(toggleBtn).toHaveAttribute('aria-label', 'Collapse sidebar')

    const initialTheme = useAppStore.getState().theme
    fireEvent.click(screen.getByTestId('theme-toggle'))
    expect(useAppStore.getState().theme).toBe(initialTheme === 'dark' ? 'light' : 'dark')
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
    useKitStore.getState().setActiveKitDirect(makeTestKit({ slug: 'private-kit' }))

    await renderSettled(
      <AuthGate>
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>
      </AuthGate>,
    )

    const signOutBtn = await screen.findByRole('button', { name: '@dev · Sign out' })
    await act(async () => {
      fireEvent.click(signOutBtn)
    })

    expect(useAppStore.getState().nodes).toEqual([])
    expect(useAppStore.getState().apiKeyConfigured).toBe(false)
    expect(useCommitStore.getState().isOpen).toBe(false)
    expect(useCommitStore.getState().messages).toEqual([])
    expect(useKitStore.getState().activeKitSlug).toBeNull()
    expect(useKitStore.getState().kits).toEqual([])
  })

  it('handles mobile fullscreen ChatPanel close, viewport resize transitions, and ⌘/ + ⌘? keyboard shortcuts', async () => {
    applyViewport(390)
    useAppStore.setState({ chatOpen: { guide: true, builder: false, study: false, chat: false } })

    await renderSettled(
      <MemoryRouter initialEntries={['/guide']}>
        <Layout />
      </MemoryRouter>,
    )

    expect(document.querySelector('#app-sidebar')?.className).toContain('hidden-mobile')
    const chatPanel = screen.getByTestId('chat-panel-container')
    expect(chatPanel.className).toContain('mobile-fullscreen')

    fireEvent.click(screen.getByRole('button', { name: 'Close chat' }))
    expect(useAppStore.getState().chatOpen.guide).toBe(false)
    expect(screen.queryByTestId('chat-panel-container')).not.toBeInTheDocument()

    applyViewport(1024)
    expect(document.querySelector('#app-sidebar')?.className).not.toContain('hidden-mobile')

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
