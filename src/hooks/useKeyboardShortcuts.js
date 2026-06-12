import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import useAppStore from '../stores/appStore'

/**
 * Global keyboard shortcuts hook.
 * Mounts once at the Layout level and handles all app-wide shortcuts.
 *
 * Navigation:
 *   ⌘1 / Ctrl+1 → Guide
 *   ⌘2 / Ctrl+2 → Builder
 *   ⌘3 / Ctrl+3 → Flashcards
 *   ⌘, / Ctrl+, → Settings
 *
 * Actions:
 *   ⌘K / Ctrl+K → Toggle chat panel for current page
 *   ⌘B / Ctrl+B → Toggle sidebar
 *   ⌘S / Ctrl+S → Save board (on builder page)
 *   ⌘D / Ctrl+D → Toggle dark/light mode
 */
export default function useKeyboardShortcuts() {
  const navigate = useNavigate()
  const location = useLocation()
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const toggleChat = useAppStore((s) => s.toggleChat)
  const toggleTheme = useAppStore((s) => s.toggleTheme)

  useEffect(() => {
    const handler = (e) => {
      // Only fire on meta (Mac) or ctrl (Windows)
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return

      // Skip if user is typing in an input/textarea
      const tag = e.target.tagName.toLowerCase()
      const isEditable = tag === 'input' || tag === 'textarea' || e.target.isContentEditable
      
      switch (e.key) {
        case '1':
          e.preventDefault()
          navigate('/guide')
          break
        case '2':
          e.preventDefault()
          navigate('/builder')
          break
        case '3':
          e.preventDefault()
          navigate('/study')
          break
        case ',':
          e.preventDefault()
          navigate('/settings')
          break
        case 'k':
        case 'K':
          e.preventDefault()
          if (location.pathname.startsWith('/guide')) toggleChat('guide')
          else if (location.pathname.startsWith('/builder')) toggleChat('builder')
          else if (location.pathname.startsWith('/study')) toggleChat('study')
          break
        case 'b':
        case 'B':
          if (!isEditable) {
            e.preventDefault()
            toggleSidebar()
          }
          break
        case 'd':
        case 'D':
          if (!isEditable) {
            e.preventDefault()
            toggleTheme()
          }
          break
        case 's':
        case 'S':
          if (location.pathname.startsWith('/builder')) {
            e.preventDefault()
            // Trigger the save button programmatically
            document.getElementById('save-board-btn')?.click()
          }
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigate, location, toggleSidebar, toggleChat, toggleTheme])
}
