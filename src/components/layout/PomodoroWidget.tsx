import { useState, useEffect } from 'react'
import type { MouseEvent } from 'react'
import { Timer as TimerIcon, Play, Pause } from 'lucide-react'
import useTimerStore, { formatTime, plantEmoji } from '../../stores/useTimerStore'
import useAppStore from '../../stores/appStore'
import PomodoroModal from './PomodoroModal'

export default function PomodoroWidget() {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const { timeLeft, status, plantState, focusLost, start, pause, resume, mode } = useTimerStore()

  useEffect(() => {
    const handler = () => setIsModalOpen(true)
    window.addEventListener('toggle-pomodoro', handler)
    return () => window.removeEventListener('toggle-pomodoro', handler)
  }, [])

  const handleAction = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (status === 'idle') start()
    else if (status === 'running') pause()
    else if (status === 'paused') resume()
  }

  const isActive = status === 'running' || status === 'paused'

  return (
    <>
      <div
        className={`sidebar-link ${isActive ? 'active' : ''}`}
        onClick={() => setIsModalOpen(true)}
        style={{
          cursor: 'pointer',
          position: 'relative',
        }}
        title="Pomodoro Timer"
      >
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <TimerIcon
            className="sidebar-link-icon"
            style={{ color: isActive ? 'var(--color-accent)' : 'inherit' }}
          />
          {collapsed && isActive && (
            <div style={{ position: 'absolute', bottom: -6, right: -6, fontSize: '10px' }}>
              {plantEmoji(plantState)}
            </div>
          )}
        </div>

        <span
          className="sidebar-link-label"
          style={{
            color: isActive ? 'var(--color-accent)' : 'inherit',
            display: 'flex',
            flexDirection: 'column',
            lineHeight: 1.2,
          }}
        >
          {isActive ? (mode === 'pomodoro' ? 'Focusing...' : 'Break Time') : 'Pomodoro'}
          {isActive && (
            <span
              style={{
                fontSize: '10px',
                fontWeight: 600,
                color: focusLost ? 'var(--color-error)' : 'var(--color-text-secondary)',
                fontFamily: 'monospace',
                marginTop: '2px',
              }}
            >
              {plantEmoji(plantState)} {formatTime(timeLeft)}
            </span>
          )}
        </span>

        {!collapsed && !isActive && (
          <span className="sidebar-shortcut hide-on-mobile">⌘9</span>
        )}

        {!collapsed && isActive && (
          <button
            onClick={handleAction}
            className="btn btn-ghost"
            style={{
              padding: '2px',
              minHeight: 0,
              borderRadius: 'var(--radius-full)',
              marginLeft: 'auto',
            }}
          >
            {status === 'running' ? <Pause size={14} /> : <Play size={14} />}
          </button>
        )}
      </div>

      {isModalOpen && <PomodoroModal onClose={() => setIsModalOpen(false)} />}
    </>
  )
}
