import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron')
vi.mock('electron-store')

import { BrowserWindow, globalShortcut } from 'electron'
import { applyHotkeySettings, toggleVisibility } from './hotkey'
import { settingsStore } from './store'

const BrowserWindowMock = BrowserWindow as unknown as {
  instances: InstanceType<typeof BrowserWindow>[]
}

beforeEach(() => {
  BrowserWindowMock.instances.length = 0
  vi.clearAllMocks()
  vi.mocked(globalShortcut.register).mockReturnValue(true)
  settingsStore.set({ hotkeyEnabled: true, hotkeyAccelerator: 'CommandOrControl+Shift+V' })
})

describe('toggleVisibility', () => {
  it('hides a visible window and shows a hidden one', () => {
    const win = new BrowserWindow()
    vi.mocked(win.isVisible).mockReturnValue(true)
    toggleVisibility(win)
    expect(win.hide).toHaveBeenCalled()

    vi.mocked(win.isVisible).mockReturnValue(false)
    toggleVisibility(win)
    expect(win.show).toHaveBeenCalled()
  })
})

describe('applyHotkeySettings', () => {
  it('unregisters everything first, then registers the configured accelerator', () => {
    new BrowserWindow()
    const result = applyHotkeySettings()

    expect(globalShortcut.unregisterAll).toHaveBeenCalled()
    expect(globalShortcut.register).toHaveBeenCalledWith(
      'CommandOrControl+Shift+V',
      expect.any(Function)
    )
    expect(result).toBe(true)
  })

  it('does nothing but still succeeds when disabled', () => {
    settingsStore.set('hotkeyEnabled', false)
    new BrowserWindow()

    expect(applyHotkeySettings()).toBe(true)
    expect(globalShortcut.register).not.toHaveBeenCalled()
  })

  it('succeeds trivially when there is no window yet', () => {
    expect(applyHotkeySettings()).toBe(true)
    expect(globalShortcut.register).not.toHaveBeenCalled()
  })

  it('reports failure when the accelerator could not be registered', () => {
    vi.mocked(globalShortcut.register).mockReturnValue(false)
    new BrowserWindow()

    expect(applyHotkeySettings()).toBe(false)
  })

  it('the registered handler toggles the first window', () => {
    const win = new BrowserWindow()
    vi.mocked(win.isVisible).mockReturnValue(true)
    applyHotkeySettings()

    const handler = vi.mocked(globalShortcut.register).mock.calls[0][1]
    handler()

    expect(win.hide).toHaveBeenCalled()
  })
})
