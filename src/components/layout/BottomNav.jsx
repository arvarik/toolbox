import { NavLink } from 'react-router-dom'
import { BookOpen, PenTool, GraduationCap, Settings } from 'lucide-react'

const navItems = [
  { to: '/guide', icon: BookOpen, label: 'Guide' },
  { to: '/builder', icon: PenTool, label: 'Builder' },
  { to: '/study', icon: GraduationCap, label: 'Flashcards' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

export default function BottomNav() {
  return (
    <nav className="bottom-nav mobile-bottom-nav" id="bottom-nav">
      {navItems.map((item) => {
        const Icon = item.icon
        return (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `bottom-nav-link mobile-bottom-nav-link${isActive ? ' active' : ''}`
            }
            id={`bottom-nav-${item.label.toLowerCase()}`}
          >
            <Icon className="bottom-nav-icon mobile-bottom-nav-icon" size={20} />
            <span className="bottom-nav-label">{item.label}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}
