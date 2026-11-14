import { useState, useRef, useEffect } from 'react'
import type { ReactNode } from 'react'
import { Loader2, ArrowDown } from 'lucide-react'
import useIsMobile from '../../hooks/useIsMobile'

export interface PullToRefreshProps {
  onRefresh: () => Promise<unknown> | unknown
  children: ReactNode
}

export default function PullToRefresh({
  onRefresh,
  children,
}: PullToRefreshProps) {
  const isMobile = useIsMobile()
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const startY = useRef(0)
  const pullDistanceRef = useRef(0)
  const isRefreshingRef = useRef(false)
  const isPullingRef = useRef(false)
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh
  const contentRef = useRef<HTMLDivElement | null>(null)

  const MAX_PULL = 120
  const THRESHOLD = 70

  useEffect(() => {
    if (!isMobile) return
    const el = contentRef.current
    if (!el) return

    const hasScrolledOffset = (target: EventTarget | null): boolean => {
      if (window.scrollY > 0) return true
      if ((document.scrollingElement?.scrollTop ?? 0) > 0) return true
      let node = target instanceof Element ? target : null
      while (node) {
        if (node.scrollTop > 0) return true
        node = node.parentElement
      }
      return false
    }

    const handleTouchStart = (e: TouchEvent) => {
      if (isRefreshingRef.current || hasScrolledOffset(e.target) || !e.touches[0]) {
        isPullingRef.current = false
        return
      }
      isPullingRef.current = true
      startY.current = e.touches[0].clientY
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (!isPullingRef.current || isRefreshingRef.current || !e.touches[0]) return
      if (hasScrolledOffset(e.target)) {
        isPullingRef.current = false
        pullDistanceRef.current = 0
        setPullDistance(0)
        return
      }
      const dist = e.touches[0].clientY - startY.current
      if (dist > 0) {
        if (e.cancelable) e.preventDefault()
        const nextPull = Math.min(dist * 0.4, MAX_PULL)
        pullDistanceRef.current = nextPull
        setPullDistance(nextPull)
      }
    }

    const handleTouchEnd = async () => {
      if (!isPullingRef.current) return
      isPullingRef.current = false
      if (pullDistanceRef.current >= THRESHOLD && !isRefreshingRef.current) {
        isRefreshingRef.current = true
        setIsRefreshing(true)
        pullDistanceRef.current = THRESHOLD
        setPullDistance(THRESHOLD)
        try {
          await onRefreshRef.current()
        } finally {
          isRefreshingRef.current = false
          setIsRefreshing(false)
          pullDistanceRef.current = 0
          setPullDistance(0)
        }
      } else {
        pullDistanceRef.current = 0
        setPullDistance(0)
      }
    }

    el.addEventListener('touchstart', handleTouchStart, { passive: true })
    el.addEventListener('touchmove', handleTouchMove, { passive: false })
    el.addEventListener('touchend', handleTouchEnd)
    el.addEventListener('touchcancel', handleTouchEnd)

    return () => {
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchmove', handleTouchMove)
      el.removeEventListener('touchend', handleTouchEnd)
      el.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [isMobile])

  if (!isMobile) return <>{children}</>

  return (
    <div ref={contentRef} style={{ position: 'relative', touchAction: 'pan-y' }}>
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
          <Loader2
            className="icon-accent"
            style={{ animation: 'spin 1s linear infinite' }}
            size={24}
          />
        ) : (
          <div
            style={{
              transform: `rotate(${Math.min(pullDistance * 2.5, 180)}deg)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ArrowDown className="icon-accent" size={24} />
          </div>
        )}
      </div>

      <div
        style={{
          transform: `translateY(${pullDistance}px)`,
          transition:
            isRefreshing || pullDistance === 0
              ? 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)'
              : 'none',
        }}
      >
        {children}
      </div>
    </div>
  )
}
