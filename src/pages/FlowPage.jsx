import { useState, useEffect, useRef } from 'react'
import { Timer, X, Play, RefreshCw } from 'lucide-react'
import FlashcardView from '../components/study/FlashcardView'
import { flashcardsApi } from '../utils/api'
import useAppStore from '../stores/appStore'

export default function FlowPage() {
  const [sessionActive, setSessionActive] = useState(false)
  const [durationMs, setDurationMs] = useState(25 * 60 * 1000)
  const [timeLeft, setTimeLeft] = useState(0)
  const [plantState, setPlantState] = useState('seed') // seed, sprout, plant, flower, dead
  const [cards, setCards] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [focusLost, setFocusLost] = useState(false)

  const timerRef = useRef(null)
  const endTimeRef = useRef(0)
  const addToast = useAppStore(s => s.addToast)

  useEffect(() => {
    return () => clearInterval(timerRef.current)
  }, [])

  useEffect(() => {
    if (!sessionActive || focusLost) return

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        setFocusLost(true)
        setPlantState('dead')
        clearInterval(timerRef.current)
        addToast({ type: 'error', message: 'You left the app! Your Focus Plant died.' })
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [sessionActive, focusLost, addToast])

  const startSession = async () => {
    setIsLoading(true)
    try {
      const res = await flashcardsApi.dueAll()
      setCards(res || [])
      
      setFocusLost(false)
      setPlantState('seed')
      setTimeLeft(durationMs)
      setSessionActive(true)

      endTimeRef.current = Date.now() + durationMs

      timerRef.current = setInterval(() => {
        const now = Date.now()
        const remaining = Math.max(0, endTimeRef.current - now)
        setTimeLeft(remaining)

        if (remaining === 0) {
          clearInterval(timerRef.current)
          setPlantState('flower')
        } else {
          const progress = 1 - (remaining / durationMs)
          if (progress > 0.75) setPlantState('flower')
          else if (progress > 0.5) setPlantState('plant')
          else if (progress > 0.25) setPlantState('sprout')
        }
      }, 1000)

    } catch {
      addToast({ type: 'error', message: 'Failed to load study material.' })
    } finally {
      setIsLoading(false)
    }
  }

  const quitSession = () => {
    clearInterval(timerRef.current)
    setSessionActive(false)
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

  const formatTime = (ms) => {
    const totalSec = Math.floor(ms / 1000)
    const mins = Math.floor(totalSec / 60)
    const secs = totalSec % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  if (!sessionActive) {
    return (
      <div className="page-layout" style={{ maxWidth: 600, margin: '0 auto', paddingTop: 'var(--space-12)', width: '100%' }}>
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
          <div style={{ 
            width: 64, height: 64, borderRadius: 'var(--radius-full)',
            background: 'var(--color-bg-tertiary)', display: 'flex', alignItems: 'center', 
            justifyContent: 'center', margin: '0 auto var(--space-4)', color: 'var(--color-accent)'
          }}>
            <Timer size={32} />
          </div>
          <h1 className="page-title">Flow State</h1>
          <p className="page-subtitle" style={{ marginTop: 'var(--space-2)', marginBottom: 'var(--space-6)' }}>
            Start a strict Pomodoro session. If you leave the app, your Focus Plant will die!
          </p>
          
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <label style={{ display: 'block', marginBottom: 'var(--space-2)', fontWeight: 600 }}>Session Duration</label>
            <div className="flex gap-2 justify-center">
              {[15, 25, 45, 60].map(mins => (
                <button 
                  key={mins}
                  className={`btn ${durationMs === mins * 60 * 1000 ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setDurationMs(mins * 60 * 1000)}
                >
                  {mins} min
                </button>
              ))}
            </div>
          </div>

          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={startSession} disabled={isLoading}>
            {isLoading ? <RefreshCw className="spin" size={16} /> : <Play size={16} />}
            Enter Flow State
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="study-layout" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Flow Header */}
      <div style={{ 
        padding: 'var(--space-4)', 
        borderBottom: '1px solid var(--color-border)', 
        background: 'var(--color-bg-secondary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <div style={{ fontSize: '2.5rem', filter: focusLost ? 'grayscale(1)' : 'none', lineHeight: 1 }}>
            {getPlantEmoji()}
          </div>
          <div>
            <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, fontFamily: 'monospace', color: focusLost ? 'var(--color-error)' : 'var(--color-text)' }}>
              {formatTime(timeLeft)}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
              {focusLost ? 'FOCUS LOST' : timeLeft === 0 ? 'SESSION COMPLETE' : 'STRICT MODE ACTIVE'}
            </div>
          </div>
        </div>
        
        <button className="btn btn-ghost" onClick={quitSession}>
          <X size={16} />
          Exit Flow
        </button>
      </div>

      {/* Study Area */}
      <div className="study-main" style={{ flex: 1, overflowY: 'auto' }}>
        {cards.length > 0 ? (
          <FlashcardView
            cards={cards}
            deckName="Flow State Review"
            reviewMode={true}
            onBack={quitSession}
          />
        ) : (
          <div style={{ textAlign: 'center', marginTop: 'var(--space-12)' }}>
            <h2 className="page-title">No Due Cards</h2>
            <p className="page-subtitle" style={{ marginTop: 'var(--space-2)' }}>
              You have no cards due for review. You can stay here and focus on other tasks!
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
