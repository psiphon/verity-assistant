import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeVerity, defaultSettings } from '#test/mocks/verity'
import type { MemoryEntry } from '@shared/types'

vi.mock('../tts/speak', () => ({
  listVoices: vi.fn(() => [])
}))

import { listVoices } from '../tts/speak'
import { SettingsPanel } from './SettingsPanel'

beforeEach(() => {
  vi.mocked(listVoices).mockReturnValue([])
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true)
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  // @ts-expect-error test-only cleanup of the global the component reads
  delete window.verity
})

function setup(
  overrides: Parameters<typeof createFakeVerity>[0] = {}
): ReturnType<typeof createFakeVerity> {
  const fake = createFakeVerity(overrides)
  window.verity = fake.api
  return fake
}

describe('SettingsPanel', () => {
  it('shows Loading... until settings resolve, then renders the form', async () => {
    setup()
    render(<SettingsPanel onClose={vi.fn()} />)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
    await screen.findByText('Settings')
    expect(screen.getByText('LLM Provider')).toBeInTheDocument()
  })

  describe('provider section', () => {
    it('shows the API Key field for anthropic by default', async () => {
      setup()
      render(<SettingsPanel onClose={vi.fn()} />)
      await screen.findByText('Settings')
      expect(screen.getByPlaceholderText('sk-...')).toBeInTheDocument()
    })

    it('hides the API Key field and adjusts placeholders when switching to ollama', async () => {
      setup()
      render(<SettingsPanel onClose={vi.fn()} />)
      await screen.findByText('Settings')

      fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'ollama' } })

      expect(screen.queryByPlaceholderText('sk-...')).not.toBeInTheDocument()
      expect(screen.getByPlaceholderText('llama3.1')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('http://localhost:11434')).toBeInTheDocument()
    })

    it('shows the local-server hint only for openai', async () => {
      setup()
      render(<SettingsPanel onClose={vi.fn()} />)
      await screen.findByText('Settings')
      expect(screen.queryByText(/usually don't check/)).not.toBeInTheDocument()

      fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'openai' } })
      expect(screen.getByText(/usually don't check/)).toBeInTheDocument()
    })
  })

  describe('system prompt', () => {
    it('shows the custom-prompt hint only once something is typed, and Use Default clears it', async () => {
      setup({ settings: defaultSettings({ systemPrompt: '' }) })
      render(<SettingsPanel onClose={vi.fn()} />)
      const textarea = await screen.findByPlaceholderText(/Leave blank to use Verity's default/)
      expect(screen.queryByText(/won't\s*apply until you clear this/)).not.toBeInTheDocument()

      fireEvent.change(textarea, { target: { value: 'You are Bob.' } })
      expect(screen.getByText(/won't/)).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Use Default' }))
      expect((textarea as HTMLTextAreaElement).value).toBe('')
    })
  })

  describe('global hotkey', () => {
    it('hides the accelerator field when disabled', async () => {
      setup({ settings: defaultSettings({ hotkeyEnabled: false }) })
      render(<SettingsPanel onClose={vi.fn()} />)
      await screen.findByText('Settings')
      expect(screen.queryByPlaceholderText('CommandOrControl+Shift+V')).not.toBeInTheDocument()
    })

    it('shows an error and keeps the panel open when registration fails', async () => {
      const fake = setup()
      vi.mocked(fake.api.settings.set).mockResolvedValueOnce({ hotkeyRegistered: false })
      const onClose = vi.fn()
      render(<SettingsPanel onClose={onClose} />)
      await screen.findByText('Settings')

      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await screen.findByText(/already be in use/)
      expect(onClose).not.toHaveBeenCalled()
    })
  })

  describe('ambient check-ins', () => {
    it('hides the interval inputs until enabled, then shows the saved defaults', async () => {
      setup()
      render(<SettingsPanel onClose={vi.fn()} />)
      await screen.findByText('Settings')
      expect(screen.queryByText('minutes')).not.toBeInTheDocument()

      fireEvent.click(screen.getByLabelText('Ambient check-ins'))
      expect(screen.getByText(/minutes/)).toBeInTheDocument()
      const [min, max] = screen.getAllByRole('spinbutton') as HTMLInputElement[]
      expect(min.value).toBe('10')
      expect(max.value).toBe('30')
    })

    it('updates the interval values when edited', async () => {
      setup({ settings: defaultSettings({ ambientEnabled: true }) })
      render(<SettingsPanel onClose={vi.fn()} />)
      await screen.findByText('Settings')
      const [min, max] = screen.getAllByRole('spinbutton') as HTMLInputElement[]

      fireEvent.change(min, { target: { value: '5' } })
      fireEvent.change(max, { target: { value: '15' } })
      expect(min.value).toBe('5')
      expect(max.value).toBe('15')
    })
  })

  describe('relationship', () => {
    it('shows the fetched rapport value and tier', async () => {
      setup({ rapport: { value: 42, tierLabel: 'Entity Emerging' } })
      render(<SettingsPanel onClose={vi.fn()} />)
      await screen.findByText('Settings')
      await waitFor(() => expect(screen.getByText(/Rapport: 42\/100/)).toBeInTheDocument())
    })

    it('does nothing when the reset confirmation is declined', async () => {
      const fake = setup()
      vi.stubGlobal(
        'confirm',
        vi.fn(() => false)
      )
      render(<SettingsPanel onClose={vi.fn()} />)
      await screen.findByText('Settings')

      fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
      expect(fake.api.rapport.reset).not.toHaveBeenCalled()
    })

    it('resets rapport to 100 when confirmed', async () => {
      const fake = setup({ rapport: { value: 20, tierLabel: 'Fully Entity' } })
      render(<SettingsPanel onClose={vi.fn()} />)
      await waitFor(() => expect(screen.getByText(/Rapport: 20\/100/)).toBeInTheDocument())

      fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
      expect(fake.api.rapport.reset).toHaveBeenCalled()
      await waitFor(() => expect(screen.getByText(/Rapport: 100\/100/)).toBeInTheDocument())
    })

    it('lists recent rapport events with their reasons', async () => {
      setup({
        rapportHistory: [
          { delta: -8, reason: 'was rude', value: 42, createdAt: '2026-01-01T00:00:00.000Z' }
        ]
      })
      render(<SettingsPanel onClose={vi.fn()} />)
      await screen.findByText(/-8 \(was rude\)/)
    })
  })

  describe('activity', () => {
    it('shows no Clear button when there is no activity yet', async () => {
      setup({ activity: [] })
      render(<SettingsPanel onClose={vi.fn()} />)
      await screen.findByText('Activity (0)')
      expect(screen.queryByRole('button', { name: 'Clear Activity' })).not.toBeInTheDocument()
    })

    it('lists recent activity newest-first and clears it', async () => {
      const fake = setup({
        activity: [
          { id: '1', tool: 'get_current_time', summary: 'get_current_time()', createdAt: '' },
          { id: '2', tool: 'play_sound', summary: 'play_sound(sound: chime)', createdAt: '' }
        ]
      })
      render(<SettingsPanel onClose={vi.fn()} />)
      await screen.findByText('Activity (2)')

      const rows = screen.getAllByText(/get_current_time\(\)|play_sound/)
      expect(rows.map((r) => r.textContent)).toEqual([
        'play_sound(sound: chime)',
        'get_current_time()'
      ])

      fireEvent.click(screen.getByRole('button', { name: 'Clear Activity' }))
      expect(fake.api.activity.clear).toHaveBeenCalled()
      await screen.findByText('Activity (0)')
    })
  })

  describe('reminders', () => {
    it('shows a none-pending hint when there are no reminders', async () => {
      setup({ reminders: [] })
      render(<SettingsPanel onClose={vi.fn()} />)
      await screen.findByText('Reminders (0)')
      expect(screen.getByText(/None pending/)).toBeInTheDocument()
    })

    it('lists pending reminders and cancels one', async () => {
      const fake = setup({
        reminders: [
          { id: '1', message: 'stretch', fireAt: new Date().toISOString(), createdAt: '' }
        ]
      })
      render(<SettingsPanel onClose={vi.fn()} />)
      await screen.findByText('Reminders (1)')
      expect(screen.getByText(/stretch/)).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Cancel reminder' }))
      expect(fake.api.reminders.cancel).toHaveBeenCalledWith('1')
      await screen.findByText('Reminders (0)')
    })
  })

  describe('conversation', () => {
    it('does nothing when the clear confirmation is declined', async () => {
      const fake = setup()
      vi.stubGlobal(
        'confirm',
        vi.fn(() => false)
      )
      render(<SettingsPanel onClose={vi.fn()} />)
      await screen.findByText('Settings')

      fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
      expect(fake.api.conversation.clear).not.toHaveBeenCalled()
    })

    it('clears the conversation when confirmed', async () => {
      const fake = setup()
      render(<SettingsPanel onClose={vi.fn()} />)
      await screen.findByText('Settings')

      fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
      await waitFor(() => expect(fake.api.conversation.clear).toHaveBeenCalled())
      expect(screen.getByText(/Cleared/)).toBeInTheDocument()
    })
  })

  describe('memories', () => {
    function memory(id: string, content: string, kind: MemoryEntry['kind'] = 'fact'): MemoryEntry {
      return { id, content, kind, createdAt: new Date().toISOString() }
    }

    it('shows an empty-state hint and no Clear All button when there are none', async () => {
      setup({ memories: [] })
      render(<SettingsPanel onClose={vi.fn()} />)
      await screen.findByText('Settings')
      expect(screen.getByText(/Nothing saved yet/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Clear All' })).not.toBeInTheDocument()
    })

    it('lists memories newest-first with a count, and deletes one', async () => {
      const fake = setup({ memories: [memory('1', 'first'), memory('2', 'second')] })
      render(<SettingsPanel onClose={vi.fn()} />)
      await screen.findByText('Memories (2)')

      const rows = screen.getAllByText(/first|second/)
      expect(rows.map((r) => r.textContent)).toEqual(['second', 'first'])

      fireEvent.click(screen.getAllByRole('button', { name: 'Forget this' })[0])
      expect(fake.api.memories.delete).toHaveBeenCalledWith('2')
      await screen.findByText('Memories (1)')
    })

    it('shows a kind badge for a non-default kind but not for a plain fact', async () => {
      setup({
        memories: [memory('1', 'likes hiking', 'preference'), memory('2', 'lives in Seattle')]
      })
      render(<SettingsPanel onClose={vi.fn()} />)
      await screen.findByText('Memories (2)')

      expect(screen.getByText('preference')).toBeInTheDocument()
      expect(screen.getByText('lives in Seattle').textContent).toBe('lives in Seattle')
    })

    it('clears all memories when Clear All is confirmed', async () => {
      const fake = setup({ memories: [memory('1', 'first')] })
      render(<SettingsPanel onClose={vi.fn()} />)
      await screen.findByText('Memories (1)')

      fireEvent.click(screen.getByRole('button', { name: 'Clear All' }))
      expect(fake.api.memories.clear).toHaveBeenCalled()
      await screen.findByText('Memories (0)')
    })
  })

  describe('text-to-speech', () => {
    it('shows voice/rate controls when enabled and hides them when disabled', async () => {
      setup({ settings: defaultSettings({ ttsEnabled: true, ttsRate: 1.5 }) })
      render(<SettingsPanel onClose={vi.fn()} />)
      await screen.findByText('Settings')
      expect(screen.getByText('Rate (1.5x)')).toBeInTheDocument()

      fireEvent.click(screen.getByLabelText('Speak replies aloud'))
      expect(screen.queryByText(/^Rate \(/)).not.toBeInTheDocument()
    })

    it('swaps the system voice select for the Fish Audio fields when the engine changes', async () => {
      setup({ settings: defaultSettings({ ttsEnabled: true }) })
      render(<SettingsPanel onClose={vi.fn()} />)
      await screen.findByText('Settings')

      // system engine by default: voice select present, fish fields absent
      expect(screen.getByText('Voice')).toBeInTheDocument()
      expect(screen.queryByPlaceholderText('http://localhost:8080')).not.toBeInTheDocument()

      fireEvent.change(screen.getByDisplayValue('System voice (offline)'), {
        target: { value: 'fish' }
      })

      expect(screen.queryByText('Voice')).not.toBeInTheDocument()
      expect(screen.getByPlaceholderText('http://localhost:8080')).toBeInTheDocument()
      expect(screen.getByPlaceholderText(/api-key/)).toBeInTheDocument()
      // rate stays available for both engines
      expect(screen.getByText(/^Rate \(/)).toBeInTheDocument()
    })

    it('edits Fish Audio server settings', async () => {
      const fake = setup({
        settings: defaultSettings({ ttsEnabled: true, ttsEngine: 'fish' })
      })
      render(<SettingsPanel onClose={vi.fn()} />)
      await screen.findByText('Settings')

      fireEvent.change(screen.getByPlaceholderText('http://localhost:8080'), {
        target: { value: 'http://localhost:9000' }
      })
      fireEvent.change(screen.getByPlaceholderText(/api-key/), { target: { value: 'shhh' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(fake.api.settings.set).toHaveBeenCalled())
      const saved = vi.mocked(fake.api.settings.set).mock.calls[0][0]
      expect(saved.fishAudio).toMatchObject({
        baseUrl: 'http://localhost:9000',
        apiKey: 'shhh'
      })
    })

    it('lists available voices in the voice select', async () => {
      vi.mocked(listVoices).mockReturnValue([
        { name: 'Alex', lang: 'en-US' } as SpeechSynthesisVoice,
        { name: 'Kyoko', lang: 'ja-JP' } as SpeechSynthesisVoice
      ])
      setup({ settings: defaultSettings({ ttsEnabled: true }) })
      render(<SettingsPanel onClose={vi.fn()} />)
      await screen.findByText('Settings')
      expect(screen.getByText('Alex (en-US)')).toBeInTheDocument()
      expect(screen.getByText('Kyoko (ja-JP)')).toBeInTheDocument()
    })
  })

  describe('MCP servers', () => {
    it('shows a no-servers hint when empty, and adds a new default row', async () => {
      setup({ settings: defaultSettings({ mcpServers: [] }) })
      render(<SettingsPanel onClose={vi.fn()} />)
      await screen.findByText('Settings')
      expect(screen.getByText('No MCP servers configured.')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: '+ Add' }))
      expect(screen.getByDisplayValue('new-server')).toBeInTheDocument()
      expect(screen.queryByText('No MCP servers configured.')).not.toBeInTheDocument()
    })

    it('removes a server row', async () => {
      setup({
        settings: defaultSettings({
          mcpServers: [{ id: 's1', name: 'my-server', command: 'npx', args: [], enabled: true }]
        })
      })
      render(<SettingsPanel onClose={vi.fn()} />)
      await screen.findByDisplayValue('my-server')

      fireEvent.click(screen.getByRole('button', { name: 'Remove server' }))
      expect(screen.queryByDisplayValue('my-server')).not.toBeInTheDocument()
      expect(screen.getByText('No MCP servers configured.')).toBeInTheDocument()
    })

    it('splits the args field on spaces into an array, normalizing repeated spaces', async () => {
      setup({
        settings: defaultSettings({
          mcpServers: [{ id: 's1', name: 'my-server', command: 'npx', args: [], enabled: true }]
        })
      })
      render(<SettingsPanel onClose={vi.fn()} />)
      const argsInput = await screen.findByPlaceholderText('args (space separated)')

      // The displayed value is derived from the args array (split -> filter
      // -> join), so a double space collapses to one on the round trip -
      // this is exercising that normalization, not a literal echo.
      fireEvent.change(argsInput, { target: { value: '-y  thing' } })
      expect((argsInput as HTMLInputElement).value).toBe('-y thing')
    })
  })

  describe('debug log', () => {
    it('shows the fetched log path and opens the log folder', async () => {
      const fake = setup()
      render(<SettingsPanel onClose={vi.fn()} />)
      await screen.findByText('/fake/log/path')

      fireEvent.click(screen.getByRole('button', { name: 'Open Log Folder' }))
      expect(fake.api.logs.openFolder).toHaveBeenCalled()
    })
  })

  describe('footer', () => {
    it('Save persists the current settings and closes the panel', async () => {
      const fake = setup()
      const onClose = vi.fn()
      render(<SettingsPanel onClose={onClose} />)
      await screen.findByText('Settings')

      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(fake.api.settings.set).toHaveBeenCalled())
      expect(onClose).toHaveBeenCalled()
    })

    it('Cancel closes the panel without saving', async () => {
      const fake = setup()
      const onClose = vi.fn()
      render(<SettingsPanel onClose={onClose} />)
      await screen.findByText('Settings')

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(fake.api.settings.set).not.toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })
  })
})
