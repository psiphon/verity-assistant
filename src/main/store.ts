import Store from 'electron-store'
import type { AppSettings } from '@shared/types'

const defaults: AppSettings = {
  activeProvider: 'anthropic',
  providers: {
    anthropic: { apiKey: '', baseUrl: '', model: '' },
    openai: { apiKey: '', baseUrl: '', model: '' },
    ollama: { apiKey: '', baseUrl: 'http://localhost:11434', model: 'llama3.1' }
  },
  mcpServers: [],
  ttsEnabled: true,
  ttsEngine: 'system',
  ttsVoice: '',
  ttsRate: 1,
  fishAudio: {
    baseUrl: 'http://localhost:8080',
    apiKey: '',
    referenceId: '',
    format: 'wav'
  },
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

export const settingsStore = new Store<AppSettings>({
  name: 'verity-settings',
  defaults
})
