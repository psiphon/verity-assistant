import type {
  AppSettings,
  McpServerStatus,
  RapportState,
  RapportEvent,
  MemoryEntry,
  TranscriptEntry,
  ActivityEntry
} from '@shared/types'

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
    ttsEngine: 'system',
    ttsVoice: '',
    ttsRate: 1,
    fishAudio: { baseUrl: 'http://localhost:8080', apiKey: '', referenceId: '', format: 'wav' },
    alwaysOnTop: false,
    facePack: 'photos',
    systemPrompt: '',
    rapport: 100,
    memories: [],
    ambientEnabled: false,
    ambientMinMinutes: 10,
    ambientMaxMinutes: 30,
    windowX: null,
    windowY: null
  }
  const statuses: McpServerStatus[] = []
  let rapport: RapportState = { value: 100, tierLabel: 'Human Facade' }
  let rapportHistory: RapportEvent[] = []
  let memories: MemoryEntry[] = [
    {
      id: '1',
      content: 'Dev mock memory example',
      kind: 'fact',
      createdAt: new Date().toISOString()
    }
  ]
  let transcript: TranscriptEntry[] = []
  let activity: ActivityEntry[] = [
    {
      id: '1',
      tool: 'get_current_time',
      summary: 'get_current_time()',
      createdAt: new Date().toISOString()
    }
  ]

  const rapportListeners = new Set<(r: RapportState) => void>()
  const messageListeners = new Set<(t: string) => void>()
  const thinkingListeners = new Set<(t: boolean) => void>()
  const conversationClearedListeners = new Set<() => void>()

  function pushTranscript(role: TranscriptEntry['role'], text: string): void {
    transcript = [
      ...transcript,
      { id: crypto.randomUUID(), role, text, createdAt: new Date().toISOString() }
    ]
  }

  function setRapport(value: number, reason = 'dev mock'): void {
    const delta = value - rapport.value
    rapport = { value: Math.max(0, Math.min(100, value)), tierLabel: tierLabelFor(value) }
    if (delta !== 0) {
      rapportHistory = [
        { delta, reason, value: rapport.value, createdAt: new Date().toISOString() },
        ...rapportHistory
      ]
    }
    rapportListeners.forEach((cb) => cb(rapport))
  }

  window.verity = {
    chat: {
      // Nudges rapport by whatever the message looks like, so you can
      // preview all four resting tiers + both talking faces without wiring
      // up a real provider.
      send: async (text: string) => {
        pushTranscript('user', text)
        thinkingListeners.forEach((cb) => cb(true))
        await new Promise((r) => setTimeout(r, 500))
        thinkingListeners.forEach((cb) => cb(false))
        const lower = text.toLowerCase()
        if (/(rude|hate|stupid|shut up)/.test(lower)) setRapport(rapport.value - 20, 'was rude')
        else if (/(thanks|sorry|kind|nice|please)/.test(lower))
          setRapport(rapport.value + 15, 'was kind')
        const reply = `(dev mock) You said: "${text}"`
        pushTranscript('assistant', reply)
        messageListeners.forEach((cb) => cb(reply))
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
        setRapport(100, 'reset')
        rapportHistory = []
        return rapport
      },
      getHistory: async () => rapportHistory,
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
    conversation: {
      get: async () => transcript,
      clear: async () => {
        transcript = []
        conversationClearedListeners.forEach((cb) => cb())
      },
      onCleared: (cb) => {
        conversationClearedListeners.add(cb)
        return () => conversationClearedListeners.delete(cb)
      }
    },
    activity: {
      get: async () => activity,
      clear: async () => {
        activity = []
        return activity
      }
    },
    settings: {
      get: async () => settings,
      set: async () => {}
    },
    tts: {
      synthesize: async () => null
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
