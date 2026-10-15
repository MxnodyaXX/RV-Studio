// Light / dark / system theme preference (a per-device convenience, kept in localStorage).
import { useSyncExternalStore } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'
const KEY = 'rv-hub:theme'
const listeners = new Set<() => void>()

export function readTheme(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

function prefersDark() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

export function applyTheme(pref: ThemePreference = readTheme()) {
  const dark = pref === 'dark' || (pref === 'system' && prefersDark())
  document.documentElement.classList.toggle('dark', dark)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#08101c' : '#14263D')
}

export function setTheme(pref: ThemePreference) {
  try {
    localStorage.setItem(KEY, pref)
  } catch {
    /* storage unavailable — still apply for this session */
  }
  applyTheme(pref)
  listeners.forEach((l) => l())
}

/** Call once at startup: applies the stored theme and follows OS changes in "system" mode. */
export function initTheme() {
  applyTheme()
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (readTheme() === 'system') applyTheme('system')
  })
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => 'system' as ThemePreference)
  return { theme, setTheme }
}
