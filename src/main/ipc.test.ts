import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron')
vi.mock('electron-store')

const { createProvider } = vi.hoisted(() => ({
  createProvider: vi.fn(() => ({ id: 'fake', chat: vi.fn() }))
}))
vi.mock('./llm', () => ({ createProvider }))

const { McpManagerMock } = vi.hoisted(() => {
  class McpManagerMock {
    static instances: McpManagerMock[] = []
    connectAll = vi.fn(async () => {})
    disconnectAll = vi.fn(async () => {})
    getTools = vi.fn((): { name: string; description: string; inputSchema: object }[] => [])
    getStatuses = vi.fn(
      (): {
        id: string
        name: string
        connected: boolean
        toolCount: number
        error?: string
      }[] => []
    )
    isMcpTool = vi.fn(() => false)
    callTool = vi.fn(async () => '')
    constructor() {
      McpManagerMock.instances.push(this)
    }
  }
  return { McpManagerMock }
})
vi.mock('./mcp/client', () => ({ McpManager: McpManagerMock }))

vi.mock('./tools/registry', () => ({
  ToolRegistry: class {
    constructor(
      public mcp: unknown,
      public ctx: unknown
    ) {}
  }
}))

const { runAgentTurn, buildSystemPrompt } = vi.hoisted(() => ({
  runAgentTurn: vi.fn(),
  buildSystemPrompt: vi.fn(() => 'system-prompt')
}))
vi.mock('./agent/loop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./agent/loop')>()
  return { ...actual, runAgentTurn, buildSystemPrompt }
})

import { BrowserWindow, ipcMain, powerMonitor, safeStorage, shell } from 'electron'
import { IPC } from '@shared/ipc'
import type { AppSettings } from '@shared/types'
import { STUCK_FALLBACK_TEXT } from './agent/loop'
import { getRapport, resetRapport } from './rapport'
import { clearMemories, getMemories, saveMemory } from './memory'
import { settingsStore } from './store'
import { registerIpcHandlers, startAmbientTimer } from './ipc'

// The real electron.d.ts (used for type-checking) has no static `instances`
// - that only exists on the test double in __mocks__/electron.ts.
const BrowserWindowMock = BrowserWindow as unknown as {
  instances: InstanceType<typeof BrowserWindow>[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (...args: any[]) => any

function getHandleHandler(channel: string): Handler {
  const calls = vi.mocked(ipcMain.handle).mock.calls
  const call = [...calls].reverse().find(([ch]) => ch === channel)
  if (!call) throw new Error(`No handle() registered for ${channel}`)
  return call[1] as Handler
}

function getOnHandler(channel: string): Handler {
  const calls = vi.mocked(ipcMain.on).mock.calls
  const call = [...calls].reverse().find(([ch]) => ch === channel)
  if (!call) throw new Error(`No on() registered for ${channel}`)
  return call[1] as Handler
}

function fakeEvent(): { sender: unknown; returnValue?: unknown } {
  return { sender: {} }
}

function baseSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    activeProvider: 'anthropic',
    providers: {
      anthropic: { apiKey: 'k', baseUrl: '', model: '' },
      openai: { apiKey: '', baseUrl: '', model: '' },
      ollama: { apiKey: '', baseUrl: 'http://localhost:11434', model: 'llama3.1' }
    },
    mcpServers: [],
    ttsEnabled: true,
    ttsVoice: '',
    ttsRate: 1,
    alwaysOnTop: false,
    systemPrompt: '',
    rapport: 100,
    memories: [],
    ambientEnabled: false,
    ambientMinMinutes: 10,
    ambientMaxMinutes: 30,
    ...overrides
  }
}

function setStoreSettings(overrides: Partial<AppSettings> = {}): void {
  settingsStore.set(baseSettings(overrides))
}

beforeEach(() => {
  // Re-registered fresh before every test rather than once in beforeAll -
  // getHandleHandler/getOnHandler always grab the most recent registration,
  // so repeated calls across tests are harmless (each handler closes over
  // the same module-level state in ipc.ts regardless of how many times
  // registerIpcHandlers() itself has run).
  registerIpcHandlers()
  setStoreSettings()
  resetRapport()
  clearMemories()
  BrowserWindowMock.instances.length = 0
  new BrowserWindow()
  createProvider.mockClear()
  runAgentTurn.mockClear()
  buildSystemPrompt.mockClear()
  McpManagerMock.instances[0]?.connectAll.mockClear()
  McpManagerMock.instances[0]?.getStatuses.mockClear()
  vi.mocked(powerMonitor.getSystemIdleTime).mockReturnValue(0)
})

describe('registerIpcHandlers', () => {
  it('registers every expected channel', () => {
    // registerIpcHandlers() is re-run fresh in beforeEach (see comment
    // there), so calls accumulate across tests in this file - each channel
    // is only checked for at-least-one registration, not an exact count.
    const handled = vi.mocked(ipcMain.handle).mock.calls.map(([ch]) => ch)
    const onned = vi.mocked(ipcMain.on).mock.calls.map(([ch]) => ch)
    for (const channel of [
      IPC.settingsGet,
      IPC.settingsSet,
      IPC.mcpStatuses,
      IPC.mcpReload,
      IPC.chatSend,
      IPC.windowToggleAlwaysOnTop,
      IPC.rapportGet,
      IPC.rapportReset,
      IPC.memoriesGet,
      IPC.memoriesDelete,
      IPC.memoriesClear,
      IPC.logsGetPath,
      IPC.logsOpenFolder
    ]) {
      expect(handled).toContain(channel)
    }
    for (const channel of [IPC.windowGetPosition, IPC.windowSetPosition, IPC.logsRendererError]) {
      expect(onned).toContain(channel)
    }
  })
})

describe('chat:send', () => {
  it('sends a thinking/message pair and forwards the right provider config', async () => {
    setStoreSettings({
      activeProvider: 'anthropic',
      providers: {
        anthropic: { apiKey: 'the-key', baseUrl: 'https://x', model: 'the-model' },
        openai: { apiKey: '', baseUrl: '', model: '' },
        ollama: { apiKey: '', baseUrl: '', model: '' }
      }
    })
    runAgentTurn.mockResolvedValueOnce({ text: 'Hello!', history: [] })

    const handler = getHandleHandler(IPC.chatSend)
    await handler(fakeEvent(), 'hi there')

    expect(createProvider).toHaveBeenCalledWith('anthropic', {
      apiKey: 'the-key',
      baseUrl: 'https://x',
      model: 'the-model'
    })
    const win = BrowserWindowMock.instances[0]
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.chatThinking, true)
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.chatMessage, 'Hello!')
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.chatThinking, false)
  })

  it('carries the growing history into the next call', async () => {
    runAgentTurn.mockResolvedValueOnce({
      text: 'first reply',
      history: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'first reply' }
      ]
    })
    const handler = getHandleHandler(IPC.chatSend)
    await handler(fakeEvent(), 'first')

    runAgentTurn.mockResolvedValueOnce({ text: 'second reply', history: [] })
    await handler(fakeEvent(), 'second')

    const secondCallHistory = runAgentTurn.mock.calls[1][2]
    expect(secondCallHistory).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'first reply' }
    ])
  })

  it('rejects a second send while a turn is already in flight (no history race)', async () => {
    let release: (v: { text: string; history: unknown[] }) => void = () => {}
    runAgentTurn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    const handler = getHandleHandler(IPC.chatSend)
    const first = handler(fakeEvent(), 'one')
    await handler(fakeEvent(), 'two')

    expect(runAgentTurn).toHaveBeenCalledTimes(1)
    const win = BrowserWindowMock.instances[0]
    expect(win.webContents.send).toHaveBeenCalledWith(
      IPC.chatError,
      expect.stringContaining('previous message')
    )

    release({ text: 'done', history: [] })
    await first
  })

  it('sends chat:error and still clears thinking when the turn throws', async () => {
    runAgentTurn.mockRejectedValueOnce(new Error('provider exploded'))
    const handler = getHandleHandler(IPC.chatSend)
    await handler(fakeEvent(), 'hi')

    const win = BrowserWindowMock.instances[0]
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.chatError, 'provider exploded')
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.chatThinking, false)
  })

  it('forwards tool calls to the renderer', async () => {
    runAgentTurn.mockImplementationOnce(async (_p, _r, _h, _u, _s, events) => {
      events.onToolCall('get_current_time', {})
      events.onToolCall('play_sound', { sound: 'chime' }, true)
      return { text: 'done', history: [] }
    })
    const handler = getHandleHandler(IPC.chatSend)
    await handler(fakeEvent(), 'hi')

    const win = BrowserWindowMock.instances[0]
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.chatToolCall, {
      name: 'get_current_time',
      input: {}
    })
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.chatToolCall, {
      name: 'play_sound',
      input: { sound: 'chime' }
    })
  })
})

describe('settings:set', () => {
  it('persists settings, reconnects MCP servers, and broadcasts statuses', async () => {
    const handler = getHandleHandler(IPC.settingsSet)
    const newSettings = baseSettings({ activeProvider: 'openai' })

    await handler(fakeEvent(), newSettings)

    expect(settingsStore.store.activeProvider).toBe('openai')
    expect(McpManagerMock.instances[0].connectAll).toHaveBeenCalledWith(newSettings.mcpServers)
    const win = BrowserWindowMock.instances[0]
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.mcpStatuses, expect.anything())
  })

  it('rejects a structurally malformed payload without persisting it', async () => {
    setStoreSettings({ activeProvider: 'anthropic' })
    const handler = getHandleHandler(IPC.settingsSet)
    await handler(fakeEvent(), { activeProvider: 'openai' }) // no providers/mcpServers
    expect(settingsStore.store.activeProvider).toBe('anthropic')
  })

  it('stores provider API keys encrypted at rest and hands the renderer plaintext back', async () => {
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true)
    vi.mocked(safeStorage.encryptString).mockImplementation((s: string) =>
      Buffer.from(`ROT:${s}`, 'utf8')
    )
    vi.mocked(safeStorage.decryptString).mockImplementation((b: Buffer) =>
      b.toString('utf8').replace(/^ROT:/, '')
    )
    try {
      const set = getHandleHandler(IPC.settingsSet)
      await set(
        fakeEvent(),
        baseSettings({
          providers: {
            anthropic: { apiKey: 'sk-live-secret', baseUrl: '', model: '' },
            openai: { apiKey: '', baseUrl: '', model: '' },
            ollama: { apiKey: '', baseUrl: '', model: '' }
          }
        })
      )

      const persisted = settingsStore.store.providers.anthropic.apiKey
      expect(persisted).not.toContain('sk-live-secret')
      expect(persisted.startsWith('enc:v1:')).toBe(true)

      const got = getHandleHandler(IPC.settingsGet)() as AppSettings
      expect(got.providers.anthropic.apiKey).toBe('sk-live-secret')
    } finally {
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)
      vi.mocked(safeStorage.encryptString).mockImplementation((s: string) => Buffer.from(s, 'utf8'))
      vi.mocked(safeStorage.decryptString).mockImplementation((b: Buffer) => b.toString('utf8'))
    }
  })
})

describe('mcp:reload', () => {
  it('reconnects using the currently stored servers and returns statuses', async () => {
    setStoreSettings({
      mcpServers: [{ id: 's1', name: 'x', command: 'npx', args: [], enabled: true }]
    })
    McpManagerMock.instances[0].getStatuses.mockReturnValue([
      { id: 's1', name: 'x', connected: true, toolCount: 2 }
    ])

    const handler = getHandleHandler(IPC.mcpReload)
    const result = await handler()

    expect(McpManagerMock.instances[0].connectAll).toHaveBeenCalledWith(
      settingsStore.store.mcpServers
    )
    expect(result).toEqual([{ id: 's1', name: 'x', connected: true, toolCount: 2 }])
  })
})

describe('window handlers', () => {
  it('toggles always-on-top and persists it', () => {
    const handler = getHandleHandler(IPC.windowToggleAlwaysOnTop)
    const win = BrowserWindowMock.instances[0]
    expect(win.isAlwaysOnTop()).toBe(false)

    const result = handler(fakeEvent())

    expect(result).toBe(true)
    expect(win.isAlwaysOnTop()).toBe(true)
    expect(settingsStore.store.alwaysOnTop).toBe(true)
  })

  it('returns [0, 0] from get-position when there is no window', () => {
    BrowserWindowMock.instances.length = 0
    const handler = getOnHandler(IPC.windowGetPosition)
    const event = fakeEvent()
    handler(event)
    expect(event.returnValue).toEqual([0, 0])
  })

  it('returns the window position via event.returnValue', () => {
    const handler = getOnHandler(IPC.windowGetPosition)
    const event = fakeEvent()
    handler(event)
    expect(event.returnValue).toEqual([0, 0])
  })

  it('sets position with the fixed window size, rounding coordinates', () => {
    const handler = getOnHandler(IPC.windowSetPosition)
    handler(fakeEvent(), 12.7, 8.2)
    expect(BrowserWindowMock.instances[0].setBounds).toHaveBeenCalledWith({
      x: 13,
      y: 8,
      width: 320,
      height: 420
    })
  })
})

describe('rapport handlers', () => {
  it('rapport:get reflects the current value and tier', () => {
    const handler = getHandleHandler(IPC.rapportGet)
    expect(handler()).toEqual({ value: 100, tierLabel: 'Human Facade' })
  })

  it('rapport:reset resets to 100', () => {
    const handler = getHandleHandler(IPC.rapportReset)
    expect(handler()).toEqual({ value: 100, tierLabel: 'Human Facade' })
    expect(getRapport()).toBe(100)
  })
})

describe('memory handlers', () => {
  it('gets, deletes, and clears memories', () => {
    const entry = saveMemory('a fact')
    expect(getHandleHandler(IPC.memoriesGet)()).toEqual([entry])

    const afterDelete = getHandleHandler(IPC.memoriesDelete)(fakeEvent(), entry.id)
    expect(afterDelete).toEqual([])

    saveMemory('another')
    const afterClear = getHandleHandler(IPC.memoriesClear)()
    expect(afterClear).toEqual([])
    expect(getMemories()).toEqual([])
  })
})

describe('logs handlers', () => {
  it('logsGetPath returns the current log path', () => {
    expect(getHandleHandler(IPC.logsGetPath)()).toEqual(expect.any(String))
  })

  it('logsOpenFolder reveals the log file', () => {
    getHandleHandler(IPC.logsOpenFolder)()
    expect(shell.showItemInFolder).toHaveBeenCalled()
  })

  it('logs:renderer-error is a fire-and-forget log write that never throws', () => {
    expect(() => getOnHandler(IPC.logsRendererError)(fakeEvent(), 'boom')).not.toThrow()
  })
})

describe('ambient check-ins', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('never calls runAgentTurn while disabled, and keeps rechecking every minute', async () => {
    setStoreSettings({ ambientEnabled: false })
    startAmbientTimer()

    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(runAgentTurn).not.toHaveBeenCalled()

    vi.useRealTimers()
  })

  it('clamps a non-finite interval instead of hot-looping LLM calls', async () => {
    setStoreSettings({
      ambientEnabled: true,
      ambientMinMinutes: NaN as unknown as number,
      ambientMaxMinutes: NaN as unknown as number
    })
    runAgentTurn.mockResolvedValue({ text: '(nothing)', history: [] })
    startAmbientTimer()

    // A NaN interval used to become setTimeout(NaN) -> fires immediately and
    // repeatedly. Clamped to the >=1min floor, nothing should fire in 59s.
    await vi.advanceTimersByTimeAsync(59_000)
    expect(runAgentTurn).not.toHaveBeenCalled()

    vi.useRealTimers()
  })

  it('fires within the configured interval once enabled', async () => {
    setStoreSettings({ ambientEnabled: true, ambientMinMinutes: 1, ambientMaxMinutes: 1 })
    runAgentTurn.mockResolvedValue({ text: '(nothing)', history: [] })
    startAmbientTimer()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(runAgentTurn).toHaveBeenCalledTimes(1)
    expect(runAgentTurn.mock.calls[0][6]).toBe(3) // AMBIENT_MAX_TOOL_ITERATIONS

    vi.useRealTimers()
  })

  it('skips a tick (but keeps rescheduling) when idle too long', async () => {
    setStoreSettings({ ambientEnabled: true, ambientMinMinutes: 1, ambientMaxMinutes: 1 })
    vi.mocked(powerMonitor.getSystemIdleTime).mockReturnValue(9999)
    startAmbientTimer()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(runAgentTurn).not.toHaveBeenCalled()

    vi.useRealTimers()
  })

  it('does not commit history or send a message when the model decides to do nothing', async () => {
    setStoreSettings({ ambientEnabled: true, ambientMinMinutes: 1, ambientMaxMinutes: 1 })
    runAgentTurn.mockResolvedValue({ text: '(nothing)', history: [{ role: 'user', content: 'x' }] })
    startAmbientTimer()

    await vi.advanceTimersByTimeAsync(60_000)
    const win = BrowserWindowMock.instances[0]
    expect(win.webContents.send).not.toHaveBeenCalledWith(IPC.chatMessage, expect.anything())

    vi.useRealTimers()
  })

  it('treats hitting the stuck fallback the same as doing nothing', async () => {
    setStoreSettings({ ambientEnabled: true, ambientMinMinutes: 1, ambientMaxMinutes: 1 })
    runAgentTurn.mockResolvedValue({ text: STUCK_FALLBACK_TEXT, history: [] })
    startAmbientTimer()

    await vi.advanceTimersByTimeAsync(60_000)
    const win = BrowserWindowMock.instances[0]
    expect(win.webContents.send).not.toHaveBeenCalledWith(IPC.chatMessage, STUCK_FALLBACK_TEXT)

    vi.useRealTimers()
  })

  it('sends the message and commits history when the model actually says something', async () => {
    setStoreSettings({ ambientEnabled: true, ambientMinMinutes: 1, ambientMaxMinutes: 1 })
    runAgentTurn.mockResolvedValue({
      text: 'Did you fall asleep?',
      history: [{ role: 'assistant', content: 'Did you fall asleep?' }]
    })
    startAmbientTimer()

    await vi.advanceTimersByTimeAsync(60_000)
    const win = BrowserWindowMock.instances[0]
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.chatMessage, 'Did you fall asleep?')

    vi.useRealTimers()
  })
})
