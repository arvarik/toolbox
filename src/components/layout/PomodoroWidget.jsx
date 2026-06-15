import { useState } from 'react'
import { Timer as TimerIcon, Play, Pause } from 'lucide-react'
import useTimerStore from '../../stores/useTimerStore'
import useAppStore from '../../stores/appStore'
import PomodoroModal from './PomodoroModal'

export default function PomodoroWidget() {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const collapsed = useAppStore(s => s.sidebarCollapsed)
  const { 
    timeLeft, status, plantState, focusLost, 
    start, pause, resume, mode
  } = useTimerStore()

  const formatTime = (ms) => {
    const totalSec = Math.floor(ms / 1000)
    const mins = Math.floor(totalSec / 60)
    const secs = totalSec % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const getPlantEmoji = () => {
    switch (plantState) {
      case 'seed': return '🌱'
      case 'sprout': return '🌿'
      case 'plant': return '🪴'
      case 'flower': return '🌸'
      case 'dead': return '🥀'
      default: return '🌱'
    }
  }

  const handleAction = (e) => {
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
          position: 'relative' // for the focus lost plant emoji
        }}
        title="Pomodoro Timer"
      >
        {/* Icon */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <TimerIcon className="sidebar-link-icon" style={{ color: isActive ? 'var(--color-accent)' : 'inherit' }} />
          {collapsed && isActive && (
            <div style={{ position: 'absolute', bottom: -6, right: -6, fontSize: '10px' }}>
              {getPlantEmoji()}
            </div>
          )}
        </div>

        {/* Label */}
        <span className="sidebar-link-label" style={{ 
          color: isActive ? 'var(--color-accent)' : 'inherit',
          display: 'flex',
          flexDirection: 'column',
          lineHeight: 1.2
        }}>
          {isActive ? (mode === 'pomodoro' ? 'Focusing...' : 'Break Time') : 'Pomodoro'}
          {isActive && (
            <span style={{ 
              fontSize: '10px', 
              fontWeight: 600, 
              color: focusLost ? 'var(--color-error)' : 'var(--color-text-secondary)',
              fontFamily: 'monospace',
              marginTop: '2px'
            }}>
              {getPlantEmoji()} {formatTime(timeLeft)}
            </span>
          )}
        </span>

        {/* Shortcut or Controls */}
        {!collapsed && !isActive && (
          <span className="sidebar-shortcut">⌘7</span>
        )}
        
        {!collapsed && isActive && (
          <button 
            onClick={handleAction}
            className="btn btn-ghost"
            style={{ 
              padding: '2px', 
              minHeight: 0, 
              borderRadius: 'var(--radius-full)',
              marginLeft: 'auto'
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
