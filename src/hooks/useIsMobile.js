import { useSyncExternalStore } from 'react'

const MOBILE_BREAKPOINT = 768

function subscribe(callback) {
  window.addEventListener('resize', callback)
  return () => window.removeEventListener('resize', callback)
}

function getSnapshot() {
  return window.innerWidth < MOBILE_BREAKPOINT
}

function getServerSnapshot() {
  return false
}

/**
 * Shared hook for mobile detection. Uses a single browser resize listener
 * via useSyncExternalStore — all consumers share the same subscription.
 *
 * @returns {boolean} true when viewport width < 768px
 */
export default function useIsMobile() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
