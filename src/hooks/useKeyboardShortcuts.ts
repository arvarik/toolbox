import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router'
import useAppStore from '../stores/appStore'
import useKitStore, { extractKitSlugFromPathname } from '../stores/useKitStore'

/**
 * Global keyboard shortcuts hook.
 * Mounts once at the Layout level and handles all app-wide shortcuts.
 */
export default function useKeyboardShortcuts(): void {
  const navigate = useNavigate()
  const location = useLocation()
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const toggleChat = useAppStore((s) => s.toggleChat)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const toggleCalcModal = useAppStore((s) => s.toggleCalcModal)
  const toggleSearch = useAppStore((s) => s.toggleSearch)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return

      const target = e.target as HTMLElement | null
      const tag = target?.tagName ? target.tagName.toLowerCase() : ''
      const isEditable = tag === 'input' || tag === 'textarea' || Boolean(target?.isContentEditable)
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
          e.preventDefault()
          toggleSearch()
          break
        case '/':
          if (!e.shiftKey) {
            e.preventDefault()
            toggleSearch()
          }
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
