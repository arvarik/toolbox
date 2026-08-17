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

const useCalcStore = create(
  persist(
    (set) => ({
      /** Calculator inputs, keyed by BOTE_INPUT_DEFS keys. */
      inputs: defaultInputs(),
      /** The problem being sized — context for presets and the AI audit. */
      scenarioId: 'custom',
      /** Latency budget items: [{ id, count }] (ids from LATENCY_NUMBERS). */
      latencyBudget: [],

      /** Set one input (clamped to its definition range). */
      setInput: (key, value) =>
        set((s) => ({ inputs: { ...s.inputs, [key]: sanitizeInput(key, value) } })),

      /**
       * Apply a scenario preset. Preset inputs merge over the current
       * ones, so advanced assumptions the preset does not name survive.
       */
      applyScenario: (scenarioId) =>
        set((s) => {
          const scenario = SCENARIOS.find((sc) => sc.id === scenarioId)
          if (!scenario) return s
          return {
            scenarioId,
            inputs: scenario.inputs ? { ...s.inputs, ...scenario.inputs } : s.inputs,
          }
        }),

      /** Reset everything to defaults. */
      reset: () => set({ inputs: defaultInputs(), scenarioId: 'custom', latencyBudget: [] }),

      /** Add one unit of a latency constant to the budget composer. */
      addLatencyItem: (id) =>
        set((s) => {
          const existing = s.latencyBudget.find((item) => item.id === id)
          if (existing) {
            return {
              latencyBudget: s.latencyBudget.map((item) =>
                item.id === id ? { ...item, count: item.count + 1 } : item
              ),
            }
          }
          return { latencyBudget: [...s.latencyBudget, { id, count: 1 }] }
        }),

      /** Set the multiplier for one budget item; 0 removes it. */
      setLatencyCount: (id, count) =>
        set((s) => ({
          latencyBudget:
            count <= 0
              ? s.latencyBudget.filter((item) => item.id !== id)
              : s.latencyBudget.map((item) => (item.id === id ? { ...item, count } : item)),
        })),

      /** Empty the latency budget. */
      clearLatencyBudget: () => set({ latencyBudget: [] }),
    }),
    {
      name: 'toolbox_calc_state',
      version: 1,
    }
  )
)

export default useCalcStore
