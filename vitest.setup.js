import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'

globalThis.React = React


// Clean up DOM after each test
afterEach(() => {
  cleanup()
})

// 1. Mock window.matchMedia (unsupported by jsdom)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // Deprecated
    removeListener: vi.fn(), // Deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// 2. Mock ResizeObserver (unsupported by jsdom, needed for chat resize)
class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserver

// 3. Mock scrollIntoView (unsupported by jsdom, used in ChatPanel message scroll)
Element.prototype.scrollIntoView = vi.fn()

// 4. Mock global fetch API
globalThis.fetch = vi.fn()

// 5. Mock localStorage
const localStorageMock = (() => {
  let store = {}
  return {
    getItem: vi.fn((key) => store[key] || null),
    setItem: vi.fn((key, value) => {
      store[key] = String(value)
    }),
    removeItem: vi.fn((key) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
    key: vi.fn((index) => Object.keys(store)[index] || null),
    get length() {
      return Object.keys(store).length
    },
  }
})()
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
})
globalThis.localStorage = localStorageMock

// Reset mock calls between tests
afterEach(() => {
  vi.clearAllMocks()
  localStorageMock.clear()
})
