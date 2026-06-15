/**
 * @fileoverview Pomodoro Timer State Machine and Store
 * Manages the global state of the Pomodoro timer, including durations, modes, and progress.
 * Integrates with a "plant" growth metaphor to incentivize studying.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Default durations for the different timer modes.
 * @constant {Object}
 * @property {number} pomodoro - 25 minutes in ms
 * @property {number} shortBreak - 5 minutes in ms
 * @property {number} longBreak - 15 minutes in ms
 */
const POMODORO_DURATIONS = {
  pomodoro: 25 * 60 * 1000,
  shortBreak: 5 * 60 * 1000,
  longBreak: 15 * 60 * 1000,
}

/**
 * Zustand store for Pomodoro state management.
 * Persists preferences (durations, strict mode) and active task name.
 */
const useTimerStore = create(
  persist(
    (set, get) => ({
      // Preferences
      durations: POMODORO_DURATIONS,
      setDuration: (mode, ms) => 
        set((state) => ({ durations: { ...state.durations, [mode]: ms } })),
      
      isStrictMode: true,
      setStrictMode: (isStrict) => set({ isStrictMode: isStrict }),

      // State
      mode: 'pomodoro', // 'pomodoro', 'shortBreak', 'longBreak'
      status: 'idle', // 'idle', 'running', 'paused', 'finished'
      timeLeft: POMODORO_DURATIONS.pomodoro,
      endTime: null,
      focusLost: false,
      plantState: 'seed', // 'seed', 'sprout', 'plant', 'flower', 'dead'
      taskName: '',

      // Actions
      setTaskName: (name) => set({ taskName: name }),
      
      start: () => {
        const { timeLeft, mode } = get()
        set({ 
          status: 'running', 
          endTime: Date.now() + timeLeft,
          focusLost: false,
          plantState: mode === 'pomodoro' ? 'seed' : 'flower' 
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
          plantState: mode === 'pomodoro' ? 'seed' : 'flower'
        })
      },

      addTime: (ms) => {
        const { status, timeLeft, endTime } = get()
        const newTimeLeft = Math.max(0, timeLeft + ms)
        
        if (status === 'running') {
          set({ timeLeft: newTimeLeft, endTime: endTime ? endTime + ms : Date.now() + newTimeLeft })
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
          plantState: newMode === 'pomodoro' ? 'seed' : 'flower'
        })
      },

      /**
       * Called on every interval tick (typically every second).
       * Updates `timeLeft` relative to `endTime`.
       * Transitions the plant state (seed -> sprout -> plant -> flower) based on progress.
       */
      tick: () => {
        const { status, endTime, mode, durations } = get()
        if (status !== 'running' || !endTime) return

        const now = Date.now()
        const remaining = Math.max(0, endTime - now)

        if (remaining === 0) {
          set({ 
            status: 'finished', 
            timeLeft: 0, 
            endTime: null,
            plantState: mode === 'pomodoro' ? 'flower' : 'flower'
          })
        } else {
          // Update plant state for pomodoro
          if (mode === 'pomodoro') {
            const durationMs = durations.pomodoro
            const progress = 1 - (remaining / durationMs)
            let newPlantState = 'seed'
            if (progress > 0.75) newPlantState = 'flower'
            else if (progress > 0.5) newPlantState = 'plant'
            else if (progress > 0.25) newPlantState = 'sprout'

            set({ timeLeft: remaining, plantState: newPlantState })
          } else {
            set({ timeLeft: remaining })
          }
        }
      },

      killPlant: () => {
        set({ 
          focusLost: true, 
          plantState: 'dead',
          status: 'paused',
          endTime: null // Pause timer when plant dies
        })
      }
    }),
    {
      name: 'toolbox_timer_settings',
      partialize: (state) => ({ 
        durations: state.durations, 
        isStrictMode: state.isStrictMode,
        taskName: state.taskName,
      }),
    }
  )
)

export default useTimerStore
