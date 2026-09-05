import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron')
vi.mock('electron-store')

import { clipboard, powerMonitor, shell, Notification } from 'electron'
import os from 'node:os'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { clearMemories, getMemories } from '../memory'
import { resetRapport } from '../rapport'
import {
  builtinToolDefinitions,
  callBuiltinTool,
  isBuiltinTool,
  SFX_NAMES,
  type BuiltinToolContext
} from './builtin'

function fakeCtx(): BuiltinToolContext {
  return { playSound: vi.fn(), flashWindow: vi.fn(), flickerWindow: vi.fn() }
}

beforeEach(() => {
  resetRapport()
  clearMemories()
  vi.clearAllMocks()
})

describe('builtinToolDefinitions', () => {
  it('merges core, filesystem, and desktop tools into one list with no duplicate names', () => {
    const names = builtinToolDefinitions().map((t) => t.name)
    expect(names).toContain('get_current_time')
    expect(names).toContain('list_directory')
    expect(names).toContain('get_battery_status')
    expect(new Set(names).size).toBe(names.length)
  })

  it('advertises exactly the four sound effect names', () => {
    const playSound = builtinToolDefinitions().find((t) => t.name === 'play_sound')
    expect(playSound?.inputSchema.properties).toMatchObject({
      sound: { enum: [...SFX_NAMES] }
    })
  })
})

describe('isBuiltinTool', () => {
  it('is true for a core tool and a merged-in filesystem tool', () => {
    expect(isBuiltinTool('get_current_time')).toBe(true)
    expect(isBuiltinTool('list_directory')).toBe(true)
  })

  it('is false for an unknown or MCP-namespaced tool', () => {
    expect(isBuiltinTool('totally_bogus_tool')).toBe(false)
    expect(isBuiltinTool('mcp__server__thing')).toBe(false)
  })
})

describe('callBuiltinTool', () => {
  it('get_current_time returns a parseable date string', async () => {
    const result = await callBuiltinTool('get_current_time', {}, fakeCtx())
    expect(new Date(result as string).toString()).not.toBe('Invalid Date')
  })

  describe('adjust_rapport', () => {
    it('applies a valid delta and returns the new value', async () => {
      const result = await callBuiltinTool(
        'adjust_rapport',
        { delta: -20, reason: 'rude' },
        fakeCtx()
      )
      expect(result).toBe('Rapport now 80/100.')
    })

    it('rejects a non-numeric delta', async () => {
      const result = await callBuiltinTool(
        'adjust_rapport',
        { delta: 'a lot', reason: 'x' },
        fakeCtx()
      )
      expect(result).toBe('delta must be a number')
    })
  })

  describe('play_sound', () => {
    it('plays a known sound via the context and confirms it', async () => {
      const ctx = fakeCtx()
      const result = await callBuiltinTool('play_sound', { sound: 'chime' }, ctx)
      expect(ctx.playSound).toHaveBeenCalledWith('chime')
      expect(result).toBe('Played chime.')
    })

    it('rejects an unknown sound name without calling the context', async () => {
      const ctx = fakeCtx()
      const result = await callBuiltinTool('play_sound', { sound: 'kaboom' }, ctx)
      expect(ctx.playSound).not.toHaveBeenCalled()
      expect(result).toContain('Unknown sound "kaboom"')
    })
  })

  describe('get_clipboard_text', () => {
    it('returns clipboard text when present', async () => {
      vi.mocked(clipboard.readText).mockReturnValue('copied text')
      const result = await callBuiltinTool('get_clipboard_text', {}, fakeCtx())
      expect(result).toBe('copied text')
    })

    it('reports an empty clipboard distinctly', async () => {
      vi.mocked(clipboard.readText).mockReturnValue('')
      const result = await callBuiltinTool('get_clipboard_text', {}, fakeCtx())
      expect(result).toBe('(clipboard is empty or not text)')
    })
  })

  it('get_idle_time reports seconds from powerMonitor', async () => {
    vi.mocked(powerMonitor.getSystemIdleTime).mockReturnValue(42)
    const result = await callBuiltinTool('get_idle_time', {}, fakeCtx())
    expect(result).toBe('42 seconds')
  })

  describe('open_url', () => {
    it('opens a valid https URL', async () => {
      const result = await callBuiltinTool(
        'open_url',
        { url: 'https://example.com/page' },
        fakeCtx()
      )
      expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/page')
      expect(result).toBe('Opened https://example.com/page')
    })

    it('rejects a malformed URL', async () => {
      const result = await callBuiltinTool('open_url', { url: 'not a url' }, fakeCtx())
      expect(result).toContain('Invalid URL')
      expect(shell.openExternal).not.toHaveBeenCalled()
    })

    it('rejects a non-http(s) protocol', async () => {
      const result = await callBuiltinTool('open_url', { url: 'file:///etc/passwd' }, fakeCtx())
      expect(result).toBe('Only http/https URLs may be opened.')
      expect(shell.openExternal).not.toHaveBeenCalled()
    })
  })

  describe('open_path', () => {
    it('requires a path', async () => {
      const result = await callBuiltinTool('open_path', {}, fakeCtx())
      expect(result).toBe('path is required')
    })

    it('opens a given path and confirms it', async () => {
      vi.mocked(shell.openPath).mockResolvedValue('')
      const result = await callBuiltinTool('open_path', { path: 'C:\\foo' }, fakeCtx())
      expect(result).toBe('Opened C:\\foo')
    })

    it('surfaces the error string shell.openPath returns on failure', async () => {
      vi.mocked(shell.openPath).mockResolvedValue('no such file')
      const result = await callBuiltinTool('open_path', { path: 'C:\\missing' }, fakeCtx())
      expect(result).toBe('Failed to open: no such file')
    })
  })

  describe('show_notification', () => {
    it('shows a notification when supported', async () => {
      vi.mocked(Notification.isSupported).mockReturnValue(true)
      const result = await callBuiltinTool(
        'show_notification',
        { title: 'Hi', body: 'there' },
        fakeCtx()
      )
      expect(result).toBe('Notification shown.')
    })

    it('reports when notifications are unsupported', async () => {
      vi.mocked(Notification.isSupported).mockReturnValue(false)
      const result = await callBuiltinTool(
        'show_notification',
        { title: 'Hi', body: 'there' },
        fakeCtx()
      )
      expect(result).toBe('Notifications are not supported on this system.')
    })
  })

  it('get_system_info reports OS/hostname/uptime/memory', async () => {
    const result = (await callBuiltinTool('get_system_info', {}, fakeCtx())) as string
    expect(result).toContain(`Hostname: ${os.hostname()}`)
    expect(result).toMatch(/Uptime: [\d.]+h/)
    expect(result).toMatch(/Memory: [\d.]+GB free of [\d.]+GB/)
  })

  describe('save_memory / recall_memories', () => {
    it('saves a memory and it becomes recallable', async () => {
      const saveResult = await callBuiltinTool(
        'save_memory',
        { content: '  likes tea  ' },
        fakeCtx()
      )
      expect(saveResult).toBe('Remembered: likes tea')
      expect(getMemories()).toHaveLength(1)

      const recallResult = await callBuiltinTool('recall_memories', { query: 'tea' }, fakeCtx())
      expect(recallResult).toBe('- likes tea')
    })

    it('requires non-empty content to save', async () => {
      const result = await callBuiltinTool('save_memory', { content: '   ' }, fakeCtx())
      expect(result).toBe('content is required')
    })

    it('reports no matching memories distinctly', async () => {
      const result = await callBuiltinTool('recall_memories', { query: 'nope' }, fakeCtx())
      expect(result).toBe('(no matching memories)')
    })
  })

  it('routes a filesystem tool name through to the filesystem module', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'verity-builtin-test-'))
    try {
      const result = (await callBuiltinTool('list_directory', { path: dir }, fakeCtx())) as string
      expect(result).toBe(`${dir} is empty.`)
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('throws for a name that matches no known builtin tool', async () => {
    await expect(callBuiltinTool('totally_bogus_tool', {}, fakeCtx())).rejects.toThrow(
      'Unknown builtin tool: totally_bogus_tool'
    )
  })
})
