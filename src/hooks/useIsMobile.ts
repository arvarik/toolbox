import { useSyncExternalStore } from 'react'

const MOBILE_BREAKPOINT = 768

function subscribe(callback: () => void): () => void {
  window.addEventListener('resize', callback)
  return () => window.removeEventListener('resize', callback)
}

function getSnapshot(): boolean {
  return window.innerWidth < MOBILE_BREAKPOINT
}

function getServerSnapshot(): boolean {
  return false
}

/**
 * Shared hook for mobile detection. Uses a single browser resize listener
 * via useSyncExternalStore — all consumers share the same subscription.
 *
 * @returns true when viewport width < 768px
 */
export default function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
