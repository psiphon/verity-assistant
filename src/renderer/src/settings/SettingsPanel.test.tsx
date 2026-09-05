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
  })

  describe('memories', () => {
    function memory(id: string, content: string): MemoryEntry {
      return { id, content, createdAt: new Date().toISOString() }
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
