import { useState, useRef, useEffect } from 'react'
import { Loader2, ArrowDown } from 'lucide-react'
import useIsMobile from '../../hooks/useIsMobile'

export default function PullToRefresh({ onRefresh, children, isEnabled = true }) {
  const isMobile = useIsMobile()
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const startY = useRef(0)
  const currentY = useRef(0)
  const contentRef = useRef(null)

  // Only enable pull-to-refresh on mobile
  const active = isEnabled && isMobile

  const MAX_PULL = 120
  const THRESHOLD = 70

  useEffect(() => {
    if (!active) return
    const el = contentRef.current
    if (!el) return

    const handleTouchStart = (e) => {
      if (window.scrollY > 0 || isRefreshing) return
      startY.current = e.touches[0].clientY
      currentY.current = startY.current
    }

    const handleTouchMove = (e) => {
      if (window.scrollY > 0 || isRefreshing) return
      currentY.current = e.touches[0].clientY
      const dist = currentY.current - startY.current
      if (dist > 0) {
        // Prevent default scrolling when pulling down
        if (e.cancelable) e.preventDefault()
        setPullDistance(Math.min(dist * 0.4, MAX_PULL))
      }
    }

    const handleTouchEnd = async () => {
      if (pullDistance >= THRESHOLD && !isRefreshing) {
        setIsRefreshing(true)
        setPullDistance(THRESHOLD) // stick at threshold while refreshing
        try {
          await onRefresh()
        } finally {
          setIsRefreshing(false)
          setPullDistance(0)
        }
      } else {
        setPullDistance(0)
      }
    }

    el.addEventListener('touchstart', handleTouchStart, { passive: true })
    el.addEventListener('touchmove', handleTouchMove, { passive: false })
    el.addEventListener('touchend', handleTouchEnd)

    return () => {
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchmove', handleTouchMove)
      el.removeEventListener('touchend', handleTouchEnd)
    }
  }, [active, isRefreshing, pullDistance, onRefresh])

  if (!active) return <>{children}</>

  return (
    <div ref={contentRef} style={{ position: 'relative', touchAction: 'pan-y' }}>
      {/* Indicator */}
      <div 
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: THRESHOLD,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `translateY(${pullDistance - THRESHOLD}px)`,
          opacity: Math.min(pullDistance / THRESHOLD, 1),
          zIndex: 10,
        }}
      >
        {isRefreshing ? (
          <Loader2 className="icon-accent" style={{ animation: 'spin 1s linear infinite' }} size={24} />
        ) : (
          <div style={{ transform: `rotate(${Math.min(pullDistance * 2.5, 180)}deg)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ArrowDown className="icon-accent" size={24} />
          </div>
        )}
      </div>

      <div 
        style={{
          transform: `translateY(${pullDistance}px)`,
          transition: isRefreshing ? 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)' : pullDistance === 0 ? 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none',
        }}
      >
        {children}
      </div>
    </div>
  )
}
