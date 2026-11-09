/**
 * @fileoverview Pomodoro Timer State Machine and Store
 * Manages the global state of the Pomodoro timer, including durations, modes, and progress.
 * Integrates with a "plant" growth metaphor to incentivize studying.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type TimerMode = 'pomodoro' | 'shortBreak' | 'longBreak'
export type TimerStatus = 'idle' | 'running' | 'paused' | 'finished'
export type PlantState = 'seed' | 'sprout' | 'plant' | 'flower' | 'dead'

const PLANT_EMOJI: Record<PlantState, string> = { seed: '🌱', sprout: '🌿', plant: '🪴', flower: '🌸', dead: '🥀' }

/** Falls back to the seed for an unknown state restored from localStorage. */
export const plantEmoji = (state: PlantState): string => PLANT_EMOJI[state] ?? '🌱'

/** 90_000 → "01:30". */
export function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const mins = Math.floor(totalSec / 60)
  const secs = totalSec % 60
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

export type TimerDurations = Record<TimerMode, number>

const POMODORO_DURATIONS: TimerDurations = {
  pomodoro: 25 * 60 * 1000,
  shortBreak: 5 * 60 * 1000,
  longBreak: 15 * 60 * 1000,
}

export interface TimerStoreState {
  durations: TimerDurations
  setDuration: (mode: TimerMode, ms: number) => void

  isStrictMode: boolean
  setStrictMode: (isStrict: boolean) => void

  mode: TimerMode
  status: TimerStatus
  timeLeft: number
  endTime: number | null
  focusLost: boolean
  plantState: PlantState
  taskName: string

  setTaskName: (name: string) => void
  start: () => void
  pause: () => void
  resume: () => void
  stop: () => void
  addTime: (ms: number) => void
  setMode: (newMode: TimerMode) => void
  tick: () => void
  killPlant: () => void
}

const useTimerStore = create<TimerStoreState>()(
  persist(
    (set, get) => ({
      durations: POMODORO_DURATIONS,
      setDuration: (mode, ms) =>
        set((state) => ({ durations: { ...state.durations, [mode]: ms } })),

      isStrictMode: true,
      setStrictMode: (isStrict) => set({ isStrictMode: isStrict }),

      mode: 'pomodoro',
      status: 'idle',
      timeLeft: POMODORO_DURATIONS.pomodoro,
      endTime: null,
      focusLost: false,
      plantState: 'seed',
      taskName: '',

      setTaskName: (name) => set({ taskName: name }),

      start: () => {
        const { timeLeft, mode } = get()
        set({
          status: 'running',
          endTime: Date.now() + timeLeft,
          focusLost: false,
          plantState: mode === 'pomodoro' ? 'seed' : 'flower',
        })
      },

      pause: () => {
        const { endTime } = get()
        if (!endTime) return
        const remaining = Math.max(0, endTime - Date.now())
        set({ status: 'paused', timeLeft: remaining, endTime: null })
      },

      resume: () => {
        const { timeLeft } = get()
        set({ status: 'running', endTime: Date.now() + timeLeft })
      },

      stop: () => {
        const { mode, durations } = get()
        set({
          status: 'idle',
          timeLeft: durations[mode],
          endTime: null,
          focusLost: false,
          plantState: mode === 'pomodoro' ? 'seed' : 'flower',
        })
      },

      addTime: (ms) => {
        const { status, timeLeft, endTime } = get()
        const newTimeLeft = Math.max(0, timeLeft + ms)

        if (status === 'running') {
          set({
            timeLeft: newTimeLeft,
            endTime: endTime ? endTime + ms : Date.now() + newTimeLeft,
          })
        } else {
          set({ timeLeft: newTimeLeft })
        }
      },

      setMode: (newMode) => {
        const { durations } = get()
        set({
          mode: newMode,
          status: 'idle',
          timeLeft: durations[newMode],
          endTime: null,
          focusLost: false,
          plantState: newMode === 'pomodoro' ? 'seed' : 'flower',
        })
      },

      tick: () => {
        const { status, endTime, mode, durations } = get()
        if (status !== 'running' || !endTime) return

        const remaining = Math.max(0, endTime - Date.now())

        if (remaining === 0) {
          set({
            status: 'finished',
            timeLeft: 0,
            endTime: null,
            plantState: 'flower',
          })
        } else if (mode === 'pomodoro') {
          const durationMs = durations.pomodoro
          const progress = 1 - remaining / durationMs
          let newPlantState: PlantState = 'seed'
          if (progress > 0.75) newPlantState = 'flower'
          else if (progress > 0.5) newPlantState = 'plant'
          else if (progress > 0.25) newPlantState = 'sprout'

          set({ timeLeft: remaining, plantState: newPlantState })
        } else {
          set({ timeLeft: remaining })
        }
      },

      killPlant: () => {
        set({
          focusLost: true,
          plantState: 'dead',
          status: 'paused',
          endTime: null,
        })
      },
    }),
    {
      name: 'toolbox_timer_settings',
      partialize: (state) => ({
        durations: state.durations,
        isStrictMode: state.isStrictMode,
        taskName: state.taskName,
      }),
    },
  ),
)

export default useTimerStore
