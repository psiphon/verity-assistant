import type { AppSettings, McpServerStatus, RapportState, MemoryEntry } from '@shared/types'

/**
 * Lets `npm run dev` be opened directly in a regular browser tab (no Electron
 * IPC available) for fast UI iteration. Only installs when window.verity is
 * missing, so it's a no-op inside the real Electron app.
 */
export function installDevMockVerityIfNeeded(): void {
  if (!import.meta.env.DEV || window.verity) return

  const settings: AppSettings = {
    activeProvider: 'anthropic',
    providers: {
      anthropic: { apiKey: '', baseUrl: '', model: '' },
      openai: { apiKey: '', baseUrl: '', model: '' },
      ollama: { apiKey: '', baseUrl: 'http://localhost:11434', model: 'llama3.1' }
    },
    mcpServers: [
      { id: '1', name: 'example-fs', command: 'npx', args: ['-y', 'example-mcp'], enabled: false }
    ],
    ttsEnabled: true,
    ttsVoice: '',
    ttsRate: 1,
    alwaysOnTop: false,
    systemPrompt: '',
    rapport: 100,
    memories: [],
    ambientEnabled: false,
    ambientMinMinutes: 10,
    ambientMaxMinutes: 30
  }
  const statuses: McpServerStatus[] = []
  let rapport: RapportState = { value: 100, tierLabel: 'Human Facade' }
  let memories: MemoryEntry[] = [
    { id: '1', content: 'Dev mock memory example', createdAt: new Date().toISOString() }
  ]

  const rapportListeners = new Set<(r: RapportState) => void>()
  const messageListeners = new Set<(t: string) => void>()
  const thinkingListeners = new Set<(t: boolean) => void>()

  function setRapport(value: number): void {
    rapport = { value: Math.max(0, Math.min(100, value)), tierLabel: tierLabelFor(value) }
    rapportListeners.forEach((cb) => cb(rapport))
  }

  window.verity = {
    chat: {
      // Nudges rapport by whatever the message looks like, so you can
      // preview all four resting tiers + both talking faces without wiring
      // up a real provider.
      send: async (text: string) => {
        thinkingListeners.forEach((cb) => cb(true))
        await new Promise((r) => setTimeout(r, 500))
        thinkingListeners.forEach((cb) => cb(false))
        const lower = text.toLowerCase()
        if (/(rude|hate|stupid|shut up)/.test(lower)) setRapport(rapport.value - 20)
        else if (/(thanks|sorry|kind|nice|please)/.test(lower)) setRapport(rapport.value + 15)
        messageListeners.forEach((cb) => cb(`(dev mock) You said: "${text}"`))
      },
      onThinking: (cb) => {
        thinkingListeners.add(cb)
        return () => thinkingListeners.delete(cb)
      },
      onMessage: (cb) => {
        messageListeners.add(cb)
        return () => messageListeners.delete(cb)
      },
      onError: () => () => {},
      onToolCall: () => () => {},
      onPlaySound: () => () => {}
    },
    rapport: {
      get: async () => rapport,
      reset: async () => {
        setRapport(100)
        return rapport
      },
      onChanged: (cb) => {
        rapportListeners.add(cb)
        return () => rapportListeners.delete(cb)
      }
    },
    memories: {
      get: async () => memories,
      delete: async (id: string) => {
        memories = memories.filter((m) => m.id !== id)
        return memories
      },
      clear: async () => {
        memories = []
        return memories
      }
    },
    settings: {
      get: async () => settings,
      set: async () => {}
    },
    mcp: {
      getStatuses: async () => statuses,
      reload: async () => statuses,
      onStatuses: () => () => {}
    },
    window: {
      toggleAlwaysOnTop: async () => false,
      onOpenSettings: (cb: () => void) => {
        // Settings only opens via the tray menu in the real app, so there's
        // no in-page button to click here - expose a manual trigger for
        // testing this preview.
        ;(window as unknown as { __devOpenSettings: () => void }).__devOpenSettings = cb
        return () => {}
      },
      getPosition: () => [0, 0],
      setPosition: () => {}
    },
    logs: {
      getPath: async () => '(dev mock - no log file)',
      openFolder: async () => {},
      reportError: (message: string) => console.error('[dev mock renderer error]', message)
    }
  }
}

function tierLabelFor(value: number): string {
  if (value > 75) return 'Human Facade'
  if (value > 50) return 'Cracking'
  if (value > 30) return 'Entity Emerging'
  return 'Fully Entity'
}
