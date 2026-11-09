import { afterAll, afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Ensure Vitest never writes to the developer's real ./data/toolbox.db
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "toolbox-vitest-"));
if (!process.env.DATA_DIR) {
  process.env.DATA_DIR = testDataDir;
}
if (!process.env.DB_PATH) {
  process.env.DB_PATH = path.join(testDataDir, "toolbox.db");
}

afterAll(() => {
  try {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
});

afterEach(() => {
  if (typeof window !== "undefined") {
    cleanup();
  }
});

if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  class ResizeObserverMock {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  window.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

  Element.prototype.scrollIntoView = vi.fn();

  globalThis.fetch = vi.fn() as unknown as typeof fetch;

  const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
      getItem: vi.fn((key: string) => store[key] || null),
      setItem: vi.fn((key: string, value: unknown) => {
        store[key] = String(value);
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        store = {};
      }),
      key: vi.fn((index: number) => Object.keys(store)[index] || null),
      get length() {
        return Object.keys(store).length;
      },
    };
  })();

  Object.defineProperty(window, "localStorage", {
    value: localStorageMock,
    writable: true,
  });
  (globalThis as unknown as { localStorage: Storage }).localStorage =
    localStorageMock as unknown as Storage;

  afterEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });
}
