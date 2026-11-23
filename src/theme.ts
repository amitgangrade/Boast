import { useSyncExternalStore } from 'react'

/** Light/dark preference: 'system' follows the device. index.html applies it before first paint. */
export type ThemeMode = 'system' | 'light' | 'dark'

const KEY = 'boast-theme'
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
const listeners = new Set<() => void>()

function read(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

let mode: ThemeMode = read()

function apply() {
  const dark = mode === 'dark' || (mode === 'system' && !!media?.matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

media?.addEventListener('change', () => mode === 'system' && apply())

export function setThemeMode(next: ThemeMode) {
  mode = next
  try {
    if (next === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, next)
  } catch {
    // Storage blocked (private mode): the choice still applies for this visit.
  }
  apply()
  listeners.forEach((l) => l())
}

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => mode,
  )
}

apply()
