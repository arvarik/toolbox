/**
 * @fileoverview BotE Calculator state.
 *
 * Persisted to localStorage so the sandbox keeps its numbers across
 * page navigation and app restarts (spec: cross-app availability).
 * The full-page calculator and the quick-access modal share this store,
 * so both views always show the same estimate.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { defaultInputs, sanitizeInput, SCENARIOS } from '../utils/bote'
import type { BoteInputKey, BoteInputs, LatencyBudgetItem } from '../utils/bote'

export interface CalcStoreState {
  inputs: BoteInputs
  scenarioId: string
  latencyBudget: LatencyBudgetItem[]
  setInput: (key: BoteInputKey, value: unknown) => void
  applyScenario: (scenarioId: string) => void
  reset: () => void
  addLatencyItem: (id: string) => void
  setLatencyCount: (id: string, count: number) => void
  clearLatencyBudget: () => void
}

const useCalcStore = create<CalcStoreState>()(
  persist(
    (set) => ({
      inputs: defaultInputs(),
      scenarioId: 'custom',
      latencyBudget: [],

      setInput: (key, value) =>
        set((s) => ({ inputs: { ...s.inputs, [key]: sanitizeInput(key, value) } })),

      applyScenario: (scenarioId) =>
        set((s) => {
          const scenario = SCENARIOS.find((sc) => sc.id === scenarioId)
          if (!scenario) return s
          return {
            scenarioId,
            inputs: scenario.inputs ? { ...s.inputs, ...scenario.inputs } : s.inputs,
          }
        }),

      reset: () => set({ inputs: defaultInputs(), scenarioId: 'custom', latencyBudget: [] }),

      addLatencyItem: (id) =>
        set((s) => {
          const existing = s.latencyBudget.find((item) => item.id === id)
          if (existing) {
            return {
              latencyBudget: s.latencyBudget.map((item) =>
                item.id === id ? { ...item, count: item.count + 1 } : item,
              ),
            }
          }
          return { latencyBudget: [...s.latencyBudget, { id, count: 1 }] }
        }),

      setLatencyCount: (id, count) =>
        set((s) => ({
          latencyBudget:
            count <= 0
              ? s.latencyBudget.filter((item) => item.id !== id)
              : s.latencyBudget.map((item) => (item.id === id ? { ...item, count } : item)),
        })),

      clearLatencyBudget: () => set({ latencyBudget: [] }),
    }),
    {
      name: 'toolbox_calc_state',
      version: 1,
    },
  ),
)

export default useCalcStore
