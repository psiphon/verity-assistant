import { BrowserWindow, globalShortcut } from 'electron'
import { settingsStore } from './store'
import { log } from './logger'

export function toggleVisibility(win: BrowserWindow): void {
  if (win.isVisible()) win.hide()
  else win.show()
}

/** (Re-)registers the global show/hide shortcut from current settings -
 * called once at startup (main/index.ts) and again whenever Settings saves
 * a change (ipc.ts), since `globalShortcut` has no "update" call, only
 * register/unregister. Returns false only when the hotkey is enabled but
 * the accelerator itself was rejected (malformed, or already claimed by
 * another app) - Settings uses that to show an error instead of silently
 * no-op'ing. */
export function applyHotkeySettings(): boolean {
  globalShortcut.unregisterAll()
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return true
  if (!settingsStore.get('hotkeyEnabled')) return true
  const accelerator = settingsStore.get('hotkeyAccelerator').trim()
  if (!accelerator) return true
  const ok = globalShortcut.register(accelerator, () => toggleVisibility(win))
  if (!ok) log.error('hotkey', `Failed to register global shortcut: ${accelerator}`)
  return ok
}
