import { vi } from 'vitest'
import type { AppSettings, MemoryEntry, McpServerStatus, RapportState } from '@shared/types'

export function defaultSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    activeProvider: 'anthropic',
    providers: {
      anthropic: { apiKey: '', baseUrl: '', model: '' },
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

function subscribable<T extends unknown[]>(): {
  add: (cb: (...args: T) => void) => () => void
  emit: (...args: T) => void
} {
  const listeners = new Set<(...args: T) => void>()
  return {
    add: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    emit: (...args) => listeners.forEach((cb) => cb(...args))
  }
}

export interface FakeVerityState {
  settings: AppSettings
  rapport: RapportState
  memories: MemoryEntry[]
}

export interface FakeVerity {
  api: Window['verity']
  state: FakeVerityState
  emit: {
    thinking: (v: boolean) => void
    message: (v: string) => void
    error: (v: string) => void
    toolCall: (c: { name: string; input: Record<string, unknown> }) => void
    playSound: (v: string) => void
    rapportChanged: (v: RapportState) => void
    openSettings: () => void
    mcpStatuses: (v: McpServerStatus[]) => void
  }
}

/** A fully-controllable stand-in for the preload-exposed `window.verity`
 * bridge, for renderer tests that would otherwise need a real Electron IPC
 * round-trip. `emit.*` simulates a push from the main process; the returned
 * `state` can be read/mutated directly to see how a component reacts. */
export function createFakeVerity(overrides: Partial<FakeVerityState> = {}): FakeVerity {
  const thinking = subscribable<[boolean]>()
  const message = subscribable<[string]>()
  const error = subscribable<[string]>()
  const toolCall = subscribable<[{ name: string; input: Record<string, unknown> }]>()
  const playSound = subscribable<[string]>()
  const rapportChanged = subscribable<[RapportState]>()
  const openSettings = subscribable<[]>()
  const mcpStatuses = subscribable<[McpServerStatus[]]>()

  const state: FakeVerityState = {
    settings: overrides.settings ?? defaultSettings(),
    rapport: overrides.rapport ?? { value: 100, tierLabel: 'Human Facade' },
    memories: overrides.memories ?? []
  }

  const api: Window['verity'] = {
    chat: {
      send: vi.fn(async () => {}),
      onThinking: thinking.add,
      onMessage: message.add,
      onError: error.add,
      onToolCall: toolCall.add,
      onPlaySound: playSound.add
    },
    rapport: {
      get: vi.fn(async () => state.rapport),
      reset: vi.fn(async () => {
        state.rapport = { value: 100, tierLabel: 'Human Facade' }
        return state.rapport
      }),
      onChanged: rapportChanged.add
    },
    memories: {
      get: vi.fn(async () => state.memories),
      delete: vi.fn(async (id: string) => {
        state.memories = state.memories.filter((m) => m.id !== id)
        return state.memories
      }),
      clear: vi.fn(async () => {
        state.memories = []
        return state.memories
      })
    },
    settings: {
      get: vi.fn(async () => state.settings),
      set: vi.fn(async (s: AppSettings) => {
        state.settings = s
      })
    },
    mcp: {
      getStatuses: vi.fn(async () => []),
      reload: vi.fn(async () => []),
      onStatuses: mcpStatuses.add
    },
    window: {
      toggleAlwaysOnTop: vi.fn(async () => false),
      onOpenSettings: openSettings.add,
      getPosition: vi.fn((): [number, number] => [0, 0]),
      setPosition: vi.fn()
    },
    logs: {
      getPath: vi.fn(async () => '/fake/log/path'),
      openFolder: vi.fn(async () => {}),
      reportError: vi.fn()
    }
  }

  return {
    api,
    state,
    emit: {
      thinking: thinking.emit,
      message: message.emit,
      error: error.emit,
      toolCall: toolCall.emit,
      playSound: playSound.emit,
      rapportChanged: rapportChanged.emit,
      openSettings: openSettings.emit,
      mcpStatuses: mcpStatuses.emit
    }
  }
}
