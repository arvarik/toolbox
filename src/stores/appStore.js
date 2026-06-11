import { create } from 'zustand'

/**
 * Global application store using Zustand.
 * Manages sidebar state, active views, and shared UI state.
 */
const useAppStore = create((set) => ({
  // Sidebar
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  // Chat panels (per-page)
  chatOpen: {
    guide: false,
    builder: false,
    study: false,
  },
  toggleChat: (page) =>
    set((s) => ({
      chatOpen: { ...s.chatOpen, [page]: !s.chatOpen[page] },
    })),
  setChatOpen: (page, open) =>
    set((s) => ({
      chatOpen: { ...s.chatOpen, [page]: open },
    })),

  // API key status
  apiKeyConfigured: false,
  setApiKeyConfigured: (status) => set({ apiKeyConfigured: status }),

  // Toast notifications
  toasts: [],
  addToast: (toast) =>
    set((s) => ({
      toasts: [...s.toasts, { id: Date.now(), ...toast }],
    })),
  removeToast: (id) =>
    set((s) => ({
      toasts: s.toasts.filter((t) => t.id !== id),
    })),
}))

export default useAppStore
