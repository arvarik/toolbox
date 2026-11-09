import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import useAppStore from '../stores/appStore'
import useKitStore, { extractKitSlugFromPathname } from '../stores/useKitStore'

/**
 * Global keyboard shortcuts hook.
 * Mounts once at the Layout level and handles all app-wide shortcuts.
 *
 * Navigation:
 *   ⌘1 / Ctrl+1 → Chat
 *   ⌘2 / Ctrl+2 → Guide
 *   ⌘3 / Ctrl+3 → Builder
 *   ⌘4 / Ctrl+4 → Flashcards
 *   ⌘5 / Ctrl+5 → Feynman
 *   ⌘6 / Ctrl+6 → Interleaved
 *   ⌘7 / Ctrl+7 → Knowledge Graph
 *   ⌘8 / Ctrl+8 → BotE Calculator
 *   ⌘, / Ctrl+, → Settings
 *
 * Actions:
 *   ⌘K / Ctrl+K → Open Command Palette / Global Search
 *   ⌘J / Ctrl+J → Toggle chat panel for current page
 *   ⌘/ / Ctrl+/ → Open Command Palette / Global Search
 *   ⌘E / Ctrl+E → Toggle quick BotE Calculator modal
 *   ⌘9 / Ctrl+9 → Toggle Pomodoro
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
  const toggleCalcModal = useAppStore((s) => s.toggleCalcModal)
  const toggleSearch = useAppStore((s) => s.toggleSearch)

  useEffect(() => {
    const handler = (e) => {
      // Only fire on meta (Mac) or ctrl (Windows)
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return

      // Skip if user is typing in an input/textarea
      const tag = e.target?.tagName ? e.target.tagName.toLowerCase() : ''
      const isEditable = tag === 'input' || tag === 'textarea' || Boolean(e.target?.isContentEditable)
      const slug = extractKitSlugFromPathname(location.pathname)
      const prefix = slug ? `/k/${encodeURIComponent(slug)}` : ''
      const subPath = location.pathname.replace(/^\/k\/[^/]+/, '') || '/'
      const caps = slug ? useKitStore.getState().activeKit?.capabilities : null

      switch (e.key) {
        case '1':
          e.preventDefault()
          navigate(`${prefix}/chat`)
          break
        case '2':
          e.preventDefault()
          navigate(`${prefix}/guide`)
          break
        case '3':
          e.preventDefault()
          if (slug && caps?.canvas === 'none') break
          navigate(
            slug && caps?.canvas === 'concept'
              ? `${prefix}/canvas`
              : `${prefix}/builder`,
          )
          break
        case '4':
          e.preventDefault()
          navigate(`${prefix}/study`)
          break
        case '5':
          e.preventDefault()
          navigate(`${prefix}/feynman`)
          break
        case '6':
          e.preventDefault()
          navigate(`${prefix}/interleaved`)
          break
        case '7':
          e.preventDefault()
          navigate(`${prefix}/graph`)
          break
        case '8':
          e.preventDefault()
          if (slug && caps?.calculator === false) break
          navigate(`${prefix}/calculator`)
          break
        case '9':
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('toggle-pomodoro'))
          break
        case 'e':
        case 'E':
          if (!isEditable && !(slug && caps?.calculator === false)) {
            e.preventDefault()
            toggleCalcModal()
          }
          break
        case ',':
          e.preventDefault()
          navigate('/settings')
          break
        case 'k':
        case 'K':
        case '/':
          e.preventDefault()
          toggleSearch()
          break
        case 'j':
        case 'J':
          e.preventDefault()
          if (subPath.startsWith('/guide')) toggleChat('guide')
          else if (subPath.startsWith('/builder') || subPath.startsWith('/canvas')) toggleChat('builder')
          else if (subPath.startsWith('/study')) toggleChat('study')
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
          if (subPath.startsWith('/builder') || subPath.startsWith('/canvas')) {
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
  }, [navigate, location, toggleSidebar, toggleChat, toggleTheme, toggleCalcModal, toggleSearch])
}
