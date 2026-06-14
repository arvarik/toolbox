import { useState } from 'react'
import { X, Play, Pause, Square, Check, RefreshCw, Settings2, Timer as TimerIcon } from 'lucide-react'
import useTimerStore from '../../stores/useTimerStore'

export default function PomodoroModal({ onClose }) {
  const {
    mode, setMode, status, timeLeft, durations, setDuration,
    start, pause, resume, stop,
    isStrictMode, setStrictMode,
    taskName, setTaskName,
    plantState, focusLost
  } = useTimerStore()

  const [isEditingSettings, setIsEditingSettings] = useState(false)
  const [tempDurations, setTempDurations] = useState({
    pomodoro: durations.pomodoro / 60000,
    shortBreak: durations.shortBreak / 60000,
    longBreak: durations.longBreak / 60000
  })

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

  const formatTime = (ms) => {
    const totalSec = Math.floor(ms / 1000)
    const mins = Math.floor(totalSec / 60)
    const secs = totalSec % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const handleSaveSettings = () => {
    setDuration('pomodoro', tempDurations.pomodoro * 60000)
    setDuration('shortBreak', tempDurations.shortBreak * 60000)
    setDuration('longBreak', tempDurations.longBreak * 60000)
    setIsEditingSettings(false)
    if (status === 'idle') {
      // Force refresh of current mode time if idle
      setMode(mode)
    }
  }

  const progress = status === 'finished' ? 1 : 1 - (timeLeft / durations[mode])
  const radius = 60
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - progress * circumference

  return (
      <div className="modal-overlay" style={{ zIndex: 9999, backdropFilter: 'blur(12px)', backgroundColor: 'rgba(0, 0, 0, 0.4)' }}>
        <div className="modal-content" style={{ maxWidth: 400, width: '100%' }}>
          <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <TimerIcon size={20} style={{ color: 'var(--color-primary)' }} />
              <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600 }}>Pomodoro Timer</h2>
            </div>
            <button className="btn btn-ghost p-1" onClick={onClose}><X size={20} /></button>
          </div>

          {isEditingSettings ? (
            <div className="settings-view">
              <h3 style={{ marginBottom: 'var(--space-4)', fontWeight: 600 }}>Timer Settings</h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: 'var(--space-6)' }}>
                <div>
                  <label style={{ display: 'block', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-1)' }}>Pomodoro (minutes)</label>
                  <input 
                    type="number" 
                    className="input" 
                    value={tempDurations.pomodoro}
                    onChange={e => setTempDurations({...tempDurations, pomodoro: Number(e.target.value)})}
                    style={{ width: '100%', padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-1)' }}>Short Break (minutes)</label>
                  <input 
                    type="number" 
                    className="input" 
                    value={tempDurations.shortBreak}
                    onChange={e => setTempDurations({...tempDurations, shortBreak: Number(e.target.value)})}
                    style={{ width: '100%', padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-1)' }}>Long Break (minutes)</label>
                  <input 
                    type="number" 
                    className="input" 
                    value={tempDurations.longBreak}
                    onChange={e => setTempDurations({...tempDurations, longBreak: Number(e.target.value)})}
                    style={{ width: '100%', padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'var(--space-2)' }}>
                  <div>
                    <div style={{ fontWeight: 500 }}>Strict Mode</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>Kills your focus plant if you leave the app</div>
                  </div>
                  <input 
                    type="checkbox" 
                    checked={isStrictMode} 
                    onChange={e => setStrictMode(e.target.checked)}
                    style={{ width: 20, height: 20 }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button className="btn btn-ghost" onClick={() => setIsEditingSettings(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleSaveSettings}>Save</button>
              </div>
            </div>
          ) : (
            <div className="timer-view" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              {/* Mode Selector */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: 'var(--space-6)' }}>
                {['pomodoro', 'shortBreak', 'longBreak'].map((m) => (
                  <button
                    key={m}
                    className={`btn ${mode === m ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ padding: 'var(--space-1) var(--space-3)', fontSize: 'var(--text-sm)' }}
                    onClick={() => setMode(m)}
                    disabled={status === 'running' || status === 'paused'}
                  >
                    {m === 'pomodoro' ? 'Pomodoro' : m === 'shortBreak' ? 'Short Break' : 'Long Break'}
                  </button>
                ))}
              </div>

              {/* Circular Timer UI */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: 'var(--space-4)' }}>
                <button 
                  className="btn btn-ghost" 
                  onClick={() => addTime(-5 * 60000)}
                  style={{ padding: '8px', borderRadius: '50%', color: 'var(--color-text-secondary)' }}
                  title="Subtract 5 minutes"
                >
                  -5m
                </button>

                <div style={{ position: 'relative', width: 200, height: 200 }}>
                  <svg width="200" height="200" viewBox="0 0 140 140" style={{ transform: 'rotate(-90deg)' }}>
                    <circle
                      cx="70" cy="70" r={radius}
                      stroke="var(--color-border)"
                      strokeWidth="8"
                      fill="none"
                    />
                    <circle
                      cx="70" cy="70" r={radius}
                      stroke={mode === 'pomodoro' ? 'var(--color-primary)' : 'var(--color-success)'}
                      strokeWidth="8"
                      fill="none"
                      strokeDasharray={circumference}
                      strokeDashoffset={strokeDashoffset}
                      style={{ transition: 'stroke-dashoffset 1s linear' }}
                    />
                  </svg>
                  <div style={{
                    position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
                  }}>
                    <div style={{ fontSize: '3rem', filter: focusLost ? 'grayscale(1)' : 'none', lineHeight: 1, marginBottom: 'var(--space-2)' }}>
                      {getPlantEmoji()}
                    </div>
                    <div style={{ 
                      fontSize: '2rem', 
                      fontWeight: 700, 
                      fontFamily: 'monospace', 
                      color: focusLost ? 'var(--color-error)' : 'var(--color-text)',
                      lineHeight: 1
                    }}>
                      {formatTime(timeLeft)}
                    </div>
                  </div>
                </div>

                <button 
                  className="btn btn-ghost" 
                  onClick={() => addTime(5 * 60000)}
                  style={{ padding: '8px', borderRadius: '50%', color: 'var(--color-text-secondary)' }}
                  title="Add 5 minutes"
                >
                  +5m
                </button>
              </div>

              {/* Task Name Input */}
              <div style={{ width: '100%', marginBottom: 'var(--space-6)' }}>
              <input
                type="text"
                placeholder="What are you working on?"
                value={taskName}
                onChange={(e) => setTaskName(e.target.value)}
                disabled={status === 'running' || status === 'paused'}
                style={{
                  width: '100%', padding: 'var(--space-2)', textAlign: 'center',
                  background: 'transparent', border: 'none', borderBottom: '1px dashed var(--color-border)',
                  color: 'var(--color-text)', outline: 'none', fontSize: 'var(--text-md)'
                }}
              />
            </div>

            {/* Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              {status === 'idle' && (
                <button className="btn btn-primary" onClick={start} style={{ borderRadius: 'var(--radius-full)', padding: 'var(--space-3)' }}>
                  <Play fill="currentColor" size={24} />
                </button>
              )}
              {status === 'running' && (
                <button className="btn btn-outline" onClick={pause} style={{ borderRadius: 'var(--radius-full)', padding: 'var(--space-3)' }}>
                  <Pause fill="currentColor" size={24} />
                </button>
              )}
              {status === 'paused' && (
                <button className="btn btn-primary" onClick={resume} style={{ borderRadius: 'var(--radius-full)', padding: 'var(--space-3)' }}>
                  <Play fill="currentColor" size={24} />
                </button>
              )}
              {(status === 'running' || status === 'paused' || status === 'finished') && (
                <button className="btn btn-ghost" onClick={stop} style={{ borderRadius: 'var(--radius-full)', padding: 'var(--space-3)' }}>
                  <Square fill="currentColor" size={24} />
                </button>
              )}
              
              {status === 'idle' && (
                <button className="btn btn-ghost" onClick={() => setIsEditingSettings(true)} style={{ position: 'absolute', right: 'var(--space-6)', bottom: 'var(--space-6)' }}>
                  <Settings2 size={20} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
