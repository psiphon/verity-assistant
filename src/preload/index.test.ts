import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron')

import { IPC } from '@shared/ipc'
import type { VerityApi } from './index'
import type * as ElectronModule from 'electron'

const originalContextIsolated = process.contextIsolated

// tsconfig.node.json (which type-checks this file) doesn't pick up the
// global Window.verity augmentation from index.d.ts the way tsconfig.web.json
// does for renderer code - a narrow cast stands in for it.
function windowGlobals(): { verity: VerityApi } {
  return window as unknown as { verity: VerityApi }
}

function setContextIsolated(value: boolean | undefined): void {
  Object.defineProperty(process, 'contextIsolated', { value, configurable: true })
}

/** vi.resetModules() invalidates any already-imported reference to a mocked
 * module too, not just the reloaded target - a statically-imported
 * `electron` from before the reset is a stale instance the freshly
 * reloaded ./index.ts never touches. Re-importing both together in one
 * "generation" keeps the references consistent. */
async function loadPreload(): Promise<typeof ElectronModule> {
  vi.resetModules()
  // @ts-expect-error test-only cleanup between reloads of the preload module
  delete window.verity
  await import('./index')
  return import('electron')
}

afterEach(() => {
  setContextIsolated(originalContextIsolated)
  vi.restoreAllMocks()
})

describe('preload bootstrap', () => {
  it('exposes verity via contextBridge when context-isolated', async () => {
    setContextIsolated(true)
    const { contextBridge } = await loadPreload()

    expect(contextBridge.exposeInMainWorld).toHaveBeenCalledWith('verity', expect.any(Object))
    expect(contextBridge.exposeInMainWorld).not.toHaveBeenCalledWith('electron', expect.anything())
  })

  it('assigns window.verity directly when not isolated', async () => {
    setContextIsolated(false)
    const { contextBridge } = await loadPreload()

    expect(contextBridge.exposeInMainWorld).not.toHaveBeenCalled()
    expect(windowGlobals().verity).toBeTruthy()
  })

  it('logs rather than crashes if exposeInMainWorld throws', async () => {
    setContextIsolated(true)
    vi.resetModules()
    const { contextBridge } = await import('electron')
    vi.mocked(contextBridge.exposeInMainWorld).mockImplementation(() => {
      throw new Error('boom')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(import('./index')).resolves.toBeDefined()
    expect(errorSpy).toHaveBeenCalled()
  })
})

describe('VerityApi wiring', () => {
  let api: VerityApi
  let electron: typeof ElectronModule

  beforeEach(async () => {
    setContextIsolated(false)
    electron = await loadPreload()
    api = windowGlobals().verity
  })

  it('chat.send invokes chat:send with the text', async () => {
    await api.chat.send('hello')
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC.chatSend, 'hello')
  })

  it('chat.onMessage registers and unregisters an ipcRenderer listener', () => {
    const cb = vi.fn()
    const unsubscribe = api.chat.onMessage(cb)
    expect(electron.ipcRenderer.on).toHaveBeenCalledWith(IPC.chatMessage, expect.any(Function))

    const listener = vi.mocked(electron.ipcRenderer.on).mock.calls[0][1]
    listener({} as never, 'hi there')
    expect(cb).toHaveBeenCalledWith('hi there')

    unsubscribe()
    expect(electron.ipcRenderer.removeListener).toHaveBeenCalledWith(IPC.chatMessage, listener)
  })

  it.each([
    ['chat.onThinking', () => api.chat.onThinking, IPC.chatThinking, true],
    ['chat.onError', () => api.chat.onError, IPC.chatError, 'oops'],
    ['chat.onToolCall', () => api.chat.onToolCall, IPC.chatToolCall, { name: 'x', input: {} }],
    ['chat.onPlaySound', () => api.chat.onPlaySound, IPC.chatPlaySound, 'chime'],
    ['mcp.onStatuses', () => api.mcp.onStatuses, IPC.mcpStatuses, []]
  ] as const)(
    '%s forwards the pushed value and unsubscribes cleanly',
    (_label, getFn, channel, value) => {
      vi.mocked(electron.ipcRenderer.on).mockClear()
      const cb = vi.fn()
      const unsubscribe = getFn()(cb as never)
      expect(electron.ipcRenderer.on).toHaveBeenCalledWith(channel, expect.any(Function))

      const listener = vi.mocked(electron.ipcRenderer.on).mock.calls[0][1]
      listener({} as never, value as never)
      expect(cb).toHaveBeenCalledWith(value)

      unsubscribe()
      expect(electron.ipcRenderer.removeListener).toHaveBeenCalledWith(channel, listener)
    }
  )

  it('rapport.get/reset invoke the right channels', async () => {
    await api.rapport.get()
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC.rapportGet)
    await api.rapport.reset()
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC.rapportReset)
  })

  it('memories.delete/clear invoke the right channels', async () => {
    await api.memories.delete('id1')
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC.memoriesDelete, 'id1')
    await api.memories.clear()
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC.memoriesClear)
  })

  it('settings.get/set invoke the right channels', async () => {
    await api.settings.get()
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC.settingsGet)
    const settings = { activeProvider: 'anthropic' } as never
    await api.settings.set(settings)
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC.settingsSet, settings)
  })

  it('mcp.getStatuses/reload invoke the right channels', async () => {
    await api.mcp.getStatuses()
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC.mcpStatuses)
    await api.mcp.reload()
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC.mcpReload)
  })

  it('window.getPosition/setPosition use sendSync/send respectively', () => {
    api.window.getPosition()
    expect(electron.ipcRenderer.sendSync).toHaveBeenCalledWith(IPC.windowGetPosition)
    api.window.setPosition(10, 20)
    expect(electron.ipcRenderer.send).toHaveBeenCalledWith(IPC.windowSetPosition, 10, 20)
  })

  it('window.toggleAlwaysOnTop and onOpenSettings wire correctly', () => {
    api.window.toggleAlwaysOnTop()
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC.windowToggleAlwaysOnTop)

    const cb = vi.fn()
    api.window.onOpenSettings(cb)
    expect(electron.ipcRenderer.on).toHaveBeenCalledWith(
      IPC.windowOpenSettings,
      expect.any(Function)
    )
  })

  it('logs.getPath/openFolder/reportError wire correctly', async () => {
    await api.logs.getPath()
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC.logsGetPath)
    await api.logs.openFolder()
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC.logsOpenFolder)
    api.logs.reportError('oops')
    expect(electron.ipcRenderer.send).toHaveBeenCalledWith(IPC.logsRendererError, 'oops')
  })
})
