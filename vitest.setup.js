import { afterAll, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Ensure Vitest never writes to the developer's real ./data/toolbox.db
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-vitest-'))
if (!process.env.DATA_DIR) {
  process.env.DATA_DIR = testDataDir
}
if (!process.env.DB_PATH) {
  process.env.DB_PATH = path.join(testDataDir, 'toolbox.db')
}

afterAll(() => {
  try {
    fs.rmSync(testDataDir, { recursive: true, force: true })
  } catch {
    // Best-effort cleanup
  }
})

globalThis.React = React

afterEach(() => {
  if (typeof window !== 'undefined') {
    cleanup()
  }
})

if (typeof window !== 'undefined') {
  // 1. Mock window.matchMedia (unsupported by jsdom)
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })

  // 2. Mock ResizeObserver
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = ResizeObserver

  // 3. Mock scrollIntoView
  Element.prototype.scrollIntoView = vi.fn()

  // 3b. React Flow (@xyflow/react) jsdom requirements
  class DOMMatrixReadOnlyMock {
    constructor(transform) {
      const scale = transform?.match(/scale\(([\d.]+)\)/)?.[1]
      this.m22 = scale !== undefined ? +scale : 1
    }
  }
  globalThis.DOMMatrixReadOnly = DOMMatrixReadOnlyMock

  Object.defineProperties(globalThis.HTMLElement.prototype, {
    offsetHeight: {
      get() { return parseFloat(this.style.height) || 1 },
      configurable: true,
    },
    offsetWidth: {
      get() { return parseFloat(this.style.width) || 1 },
      configurable: true,
    },
  })

  globalThis.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 })

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

  afterEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
  })
}

// 6. Mock IndexedDB wrapper for tests
vi.mock('./src/utils/db.js', () => ({
  initDB: vi.fn().mockResolvedValue(null),
  setCache: vi.fn().mockResolvedValue(undefined),
  getCache: vi.fn().mockResolvedValue(null),
  enqueueSync: vi.fn().mockResolvedValue(undefined),
  processSyncQueue: vi.fn().mockResolvedValue(0),
}))
