import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Sidebar from '../components/layout/Sidebar'
import Layout from '../components/layout/Layout'
import useAppStore from '../stores/appStore'

// MANDATORY INTEGRITY WARNING:
// DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, 
// create dummy/facade implementations, or circumvent the intended task. A Forensic 
// Auditor will independently verify your work. Integrity violations WILL be detected 
// and your work WILL be rejected.

describe('Sidebar Navigation & Mobile Responsiveness Test Suite', () => {
  // Helper to set viewport width and mock matchMedia
  const setViewport = (width) => {
    window.innerWidth = width;
    window.matchMedia = vi.fn().mockImplementation((query) => {
      const isMobile = width < 768;
      const matches = (query.includes('max-width') || query.includes('width <') || query.includes('width <=') || query.includes('768') || query.includes('640'))
        ? isMobile
        : !isMobile;
      return {
        matches,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    });
    window.dispatchEvent(new Event('resize'));
  };

  beforeEach(() => {
    // Reset store state before each test
    useAppStore.setState({
      sidebarCollapsed: false,
      chatOpen: { chat: false, guide: false, builder: false, study: false },
      apiKeyConfigured: false,
      toasts: [],
    });
    // Default to desktop view
    setViewport(1024);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================
  // Part 1: Sidebar Navigation (10 Tests)
  // ==========================================

  describe('Sidebar Navigation (Desktop Mode)', () => {
    // Tier 1: 5 tests

    it('1. renders navigation links with correct destinations', () => {
      render(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>
      );
      
      const guideLink = screen.getByRole('link', { name: /guide/i });
      const builderLink = screen.getByRole('link', { name: /builder/i });
      const studyLink = screen.getByRole('link', { name: /flashcards/i });
      const settingsLink = screen.getByRole('link', { name: /settings/i });

      expect(guideLink).toBeInTheDocument();
      expect(builderLink).toBeInTheDocument();
      expect(studyLink).toBeInTheDocument();
      expect(settingsLink).toBeInTheDocument();

      expect(guideLink.getAttribute('href')).toBe('/guide');
      expect(builderLink.getAttribute('href')).toBe('/builder');
      expect(studyLink.getAttribute('href')).toBe('/study');
      expect(settingsLink.getAttribute('href')).toBe('/settings');
    });

    it('2. renders the application title and logo', () => {
      render(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>
      );

      const title = screen.getByText('Toolbox');
      expect(title).toBeInTheDocument();
      expect(title.className).toContain('sidebar-title');
    });

    it('3. calls toggle action on collapse button click', async () => {
      render(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>
      );

      const toggleButton = screen.getByRole('button', { name: /collapse sidebar/i });
      expect(useAppStore.getState().sidebarCollapsed).toBe(false);

      fireEvent.click(toggleButton);
      expect(useAppStore.getState().sidebarCollapsed).toBe(true);
    });

    it('4. adds the collapsed class to sidebar container when collapsed is true', () => {
      useAppStore.setState({ sidebarCollapsed: true });
      
      render(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>
      );

      const sidebarContainer = document.querySelector('#app-sidebar') || document.querySelector('.sidebar');
      expect(sidebarContainer).toBeInTheDocument();
      expect(sidebarContainer.className).toContain('collapsed');
    });

    it('5. provides elements with interactive states and class setups', () => {
      render(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>
      );

      const toggleButton = screen.getByRole('button', { name: /collapse sidebar/i });
      const guideLink = screen.getByRole('link', { name: /guide/i });

      // Verify they have correct class identifiers for hover styling
      expect(toggleButton.className).toContain('sidebar-collapse-btn');
      expect(guideLink.className).toContain('sidebar-link');

      // Simulate hover interactions without errors
      fireEvent.mouseOver(toggleButton);
      fireEvent.mouseOut(toggleButton);
      fireEvent.mouseOver(guideLink);
      fireEvent.mouseOut(guideLink);
    });

    // Tier 2: 5 tests

    it('6. persists and cycles state correctly over repeated toggles', () => {
      render(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>
      );

      const toggleButton = screen.getByRole('button', { name: /collapse/i });
      const sidebarContainer = document.querySelector('#app-sidebar') || document.querySelector('.sidebar');

      // Cycle 1: Collapse
      fireEvent.click(toggleButton);
      expect(useAppStore.getState().sidebarCollapsed).toBe(true);
      expect(sidebarContainer.className).toContain('collapsed');

      // Cycle 2: Expand
      fireEvent.click(toggleButton);
      expect(useAppStore.getState().sidebarCollapsed).toBe(false);
      expect(sidebarContainer.className).not.toContain('collapsed');

      // Cycle 3: Collapse again
      fireEvent.click(toggleButton);
      expect(useAppStore.getState().sidebarCollapsed).toBe(true);
      expect(sidebarContainer.className).toContain('collapsed');
    });

    it('7. highlights active link based on the current active route', () => {
      render(
        <MemoryRouter initialEntries={['/builder']}>
          <Sidebar />
        </MemoryRouter>
      );

      const builderLink = screen.getByRole('link', { name: /builder/i });
      const guideLink = screen.getByRole('link', { name: /guide/i });

      expect(builderLink.className).toContain('active');
      expect(guideLink.className).not.toContain('active');
    });

    it('8. renders navigation items with long labels gracefully', () => {
      // Create a customized navigation element or check that standard labels render
      render(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>
      );

      // Verify that labels exist in the DOM and are not cropped in JSX
      const flashcardsLabel = screen.getByText('Flashcards');
      expect(flashcardsLabel).toBeInTheDocument();
      expect(flashcardsLabel.className).toContain('sidebar-link-label');
    });

    it('9. handles empty navigation scenarios gracefully without crashing', () => {
      // Mock empty state scenario for appStore or ensure minimal sidebar compiles
      render(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>
      );

      const sidebarContainer = document.querySelector('#app-sidebar') || document.querySelector('.sidebar');
      expect(sidebarContainer).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /collapse/i })).toBeInTheDocument();
    });

    it('10. updates aria-label of the toggle button dynamically', () => {
      render(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>
      );

      const toggleButton = screen.getByRole('button', { name: /collapse/i });
      expect(toggleButton.getAttribute('aria-label')).toBe('Collapse sidebar');

      // Collapse the sidebar
      fireEvent.click(toggleButton);
      expect(toggleButton.getAttribute('aria-label')).toBe('Expand sidebar');

      // Expand it again
      fireEvent.click(toggleButton);
      expect(toggleButton.getAttribute('aria-label')).toBe('Collapse sidebar');
    });
  });

  // ==========================================
  // Part 2: Mobile Responsiveness (10 Tests)
  // ==========================================

  describe('Mobile Responsiveness', () => {
    // Tier 1: 5 tests

    it('11. hides the sidebar on mobile viewports (<768px)', () => {
      setViewport(390); // Mobile iPhone width

      render(
        <MemoryRouter>
          <Layout />
        </MemoryRouter>
      );

      const sidebar = document.querySelector('#app-sidebar') || document.querySelector('.sidebar');
      
      // If sidebar is rendered, it must have class indicating it is hidden/collapsed on mobile
      if (sidebar) {
        const isHidden = 
          sidebar.className.includes('hidden') || 
          sidebar.className.includes('mobile-hidden') || 
          window.getComputedStyle(sidebar).display === 'none' ||
          sidebar.className.includes('md:flex') || // Tailwind style hidden by default
          sidebar.className.includes('hidden-mobile');
        expect(isHidden).toBe(true);
      } else {
        expect(sidebar).toBeNull();
      }
    });

    it('12. displays the hamburger menu button on mobile viewports (<768px)', () => {
      setViewport(390);

      render(
        <MemoryRouter>
          <Layout />
        </MemoryRouter>
      );

      const hamburger = 
        screen.queryByRole('button', { name: /menu/i }) ||
        screen.queryByRole('button', { name: /open menu/i }) ||
        document.querySelector('#hamburger-menu') ||
        document.querySelector('.hamburger-menu') ||
        document.querySelector('#mobile-menu-btn');

      expect(hamburger).toBeInTheDocument();
    });

    it('13. opens the overlay navigation menu when clicking the hamburger menu', () => {
      setViewport(390);

      render(
        <MemoryRouter>
          <Layout />
        </MemoryRouter>
      );

      const hamburger = 
        screen.queryByRole('button', { name: /menu/i }) ||
        screen.queryByRole('button', { name: /open menu/i }) ||
        document.querySelector('#hamburger-menu') ||
        document.querySelector('.hamburger-menu') ||
        document.querySelector('#mobile-menu-btn');

      expect(hamburger).toBeInTheDocument();
      fireEvent.click(hamburger);

      const overlay = 
        document.querySelector('#mobile-nav-overlay') ||
        document.querySelector('.mobile-overlay') ||
        document.querySelector('#mobile-menu') ||
        screen.queryByRole('navigation', { name: /mobile/i });

      expect(overlay).toBeInTheDocument();
      
      // Mobile overlay should contain navigation links
      const guideLink = overlay.querySelector('[href="/guide"]') || screen.queryByRole('link', { name: /guide/i });
      expect(guideLink).toBeInTheDocument();
    });

    it('14. displays the bottom navigation bar with correct tabs on mobile viewports (<768px)', () => {
      setViewport(390);

      render(
        <MemoryRouter>
          <Layout />
        </MemoryRouter>
      );

      const bottomNav = 
        document.querySelector('#bottom-nav') ||
        document.querySelector('.bottom-nav') ||
        screen.queryByRole('navigation', { name: /bottom/i });

      expect(bottomNav).toBeInTheDocument();

      // Check for tabs inside bottom navigation
      const guideTab = bottomNav.querySelector('[href="/guide"]') || screen.queryByText(/guide/i);
      const builderTab = bottomNav.querySelector('[href="/builder"]') || screen.queryByText(/builder/i);
      const studyTab = bottomNav.querySelector('[href="/study"]') || screen.queryByText(/flashcards/i);

      expect(guideTab).toBeInTheDocument();
      expect(builderTab).toBeInTheDocument();
      expect(studyTab).toBeInTheDocument();
    });

    it('15. renders the AI chat panel in fullscreen layout on mobile viewports (<768px)', () => {
      setViewport(390);
      // Open the chat panel for the guide page
      useAppStore.setState({ chatOpen: { guide: true, builder: false, study: false } });

      render(
        <MemoryRouter initialEntries={['/guide']}>
          <Layout />
        </MemoryRouter>
      );

      const chatPanel = 
        document.querySelector('.chat-panel') ||
        document.querySelector('[id^="chat-panel-"]');

      expect(chatPanel).toBeInTheDocument();
      // Chat panel should have fullscreen class or style on mobile
      const hasFullscreenClass = 
        chatPanel.className.includes('fullscreen') ||
        chatPanel.className.includes('mobile-fullscreen') ||
        chatPanel.className.includes('w-full') ||
        window.getComputedStyle(chatPanel).width === '100%';
      expect(hasFullscreenClass).toBe(true);
    });

    // Tier 2: 5 tests

    it('16. toggles responsive states dynamically upon resize events', () => {
      // Start in desktop
      setViewport(1024);
      
      const { rerender } = render(
        <MemoryRouter>
          <Layout />
        </MemoryRouter>
      );

      let sidebar = document.querySelector('#app-sidebar') || document.querySelector('.sidebar');
      let hamburger = 
        document.querySelector('#hamburger-menu') ||
        document.querySelector('.hamburger-menu') ||
        document.querySelector('#mobile-menu-btn') ||
        screen.queryByRole('button', { name: /menu/i });

      // On desktop, sidebar is visible (not hidden) and hamburger is hidden/not-present
      if (sidebar) {
        const isHidden = sidebar.className.includes('hidden') || sidebar.className.includes('mobile-hidden') || window.getComputedStyle(sidebar).display === 'none';
        expect(isHidden).toBe(false);
      }
      expect(hamburger).not.toBeInTheDocument();

      // Resize to mobile
      setViewport(390);
      rerender(
        <MemoryRouter>
          <Layout />
        </MemoryRouter>
      );

      sidebar = document.querySelector('#app-sidebar') || document.querySelector('.sidebar');
      hamburger = 
        document.querySelector('#hamburger-menu') ||
        document.querySelector('.hamburger-menu') ||
        document.querySelector('#mobile-menu-btn') ||
        screen.queryByRole('button', { name: /menu/i }) ||
        screen.queryByRole('button', { name: /open menu/i });

      // On mobile, sidebar is hidden/absent and hamburger is visible
      if (sidebar) {
        const isHidden = 
          sidebar.className.includes('hidden') || 
          sidebar.className.includes('mobile-hidden') || 
          window.getComputedStyle(sidebar).display === 'none' ||
          sidebar.className.includes('md:flex') ||
          sidebar.className.includes('hidden-mobile');
        expect(isHidden).toBe(true);
      } else {
        expect(sidebar).toBeNull();
      }
      expect(hamburger).toBeInTheDocument();

      // Resize back to desktop
      setViewport(1024);
      rerender(
        <MemoryRouter>
          <Layout />
        </MemoryRouter>
      );

      sidebar = document.querySelector('#app-sidebar') || document.querySelector('.sidebar');
      hamburger = 
        document.querySelector('#hamburger-menu') ||
        document.querySelector('.hamburger-menu') ||
        document.querySelector('#mobile-menu-btn') ||
        screen.queryByRole('button', { name: /menu/i });

      if (sidebar) {
        const isHidden = sidebar.className.includes('hidden') || sidebar.className.includes('mobile-hidden') || window.getComputedStyle(sidebar).display === 'none';
        expect(isHidden).toBe(false);
      }
      expect(hamburger).not.toBeInTheDocument();
    });

    it('17. closes mobile overlay menu when close button is clicked', () => {
      setViewport(390);

      render(
        <MemoryRouter>
          <Layout />
        </MemoryRouter>
      );

      const hamburger = 
        screen.queryByRole('button', { name: /menu/i }) ||
        screen.queryByRole('button', { name: /open menu/i }) ||
        document.querySelector('#hamburger-menu') ||
        document.querySelector('.hamburger-menu') ||
        document.querySelector('#mobile-menu-btn');

      fireEvent.click(hamburger);

      const overlay = 
        document.querySelector('#mobile-nav-overlay') ||
        document.querySelector('.mobile-overlay') ||
        document.querySelector('#mobile-menu') ||
        screen.queryByRole('navigation', { name: /mobile/i });

      expect(overlay).toBeInTheDocument();

      const closeBtn = 
        overlay.querySelector('#mobile-nav-close') ||
        overlay.querySelector('.close-btn') ||
        screen.queryByRole('button', { name: /close/i }) ||
        overlay.querySelector('button');

      expect(closeBtn).toBeInTheDocument();
      fireEvent.click(closeBtn);

      expect(overlay).not.toBeInTheDocument();
    });

    it('18. applies active styles/classes to the active route inside mobile overlay', () => {
      setViewport(390);

      render(
        <MemoryRouter initialEntries={['/study']}>
          <Layout />
        </MemoryRouter>
      );

      const hamburger = 
        screen.queryByRole('button', { name: /menu/i }) ||
        screen.queryByRole('button', { name: /open menu/i }) ||
        document.querySelector('#hamburger-menu') ||
        document.querySelector('.hamburger-menu') ||
        document.querySelector('#mobile-menu-btn');

      fireEvent.click(hamburger);

      const overlay = 
        document.querySelector('#mobile-nav-overlay') ||
        document.querySelector('.mobile-overlay') ||
        document.querySelector('#mobile-menu') ||
        screen.queryByRole('navigation', { name: /mobile/i });

      const studyLink = overlay.querySelector('[href="/study"]');
      const guideLink = overlay.querySelector('[href="/guide"]');

      expect(studyLink).toBeInTheDocument();
      expect(studyLink.className).toContain('active');
      
      if (guideLink) {
        expect(guideLink.className).not.toContain('active');
      }
    });

    it('19. navigates to correct pages upon clicking bottom nav bar items', async () => {
      setViewport(390);

      // Render the App to test full page routing on bottom nav click
      render(
        <MemoryRouter initialEntries={['/guide']}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/guide" element={<div data-testid="guide-page">Guide Content</div>} />
              <Route path="/builder" element={<div data-testid="builder-page">Builder Content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      );

      const bottomNav = 
        document.querySelector('#bottom-nav') ||
        document.querySelector('.bottom-nav') ||
        screen.queryByRole('navigation', { name: /bottom/i });

      expect(bottomNav).toBeInTheDocument();
      expect(screen.getByTestId('guide-page')).toBeInTheDocument();

      const builderTab = bottomNav.querySelector('[href="/builder"]') || screen.getByText(/builder/i);
      fireEvent.click(builderTab);

      await waitFor(() => {
        expect(screen.getByTestId('builder-page')).toBeInTheDocument();
        expect(screen.queryByTestId('guide-page')).not.toBeInTheDocument();
      });
    });

    it('20. closes the mobile fullscreen chat overlay when clicking the close button', () => {
      setViewport(390);
      useAppStore.setState({ chatOpen: { guide: true, builder: false, study: false } });

      render(
        <MemoryRouter initialEntries={['/guide']}>
          <Layout />
        </MemoryRouter>
      );

      const chatPanel = 
        document.querySelector('.chat-panel') ||
        document.querySelector('[id^="chat-panel-"]');

      expect(chatPanel).toBeInTheDocument();

      const closeChatBtn = 
        chatPanel.querySelector('button[aria-label="Close chat"]') ||
        screen.queryByRole('button', { name: /close chat/i });

      expect(closeChatBtn).toBeInTheDocument();
      fireEvent.click(closeChatBtn);

      expect(useAppStore.getState().chatOpen.guide).toBe(false);
      expect(chatPanel).not.toBeInTheDocument();
    });
  });
});
