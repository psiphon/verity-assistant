import { describe, expect, it, vi } from 'vitest'

vi.mock('electron')

import type { McpManager } from '../mcp/client'
import type { BuiltinToolContext } from './builtin'
import { ToolRegistry } from './registry'

function fakeMcp(overrides: Partial<McpManager> = {}): McpManager {
  return {
    getTools: vi.fn(() => []),
    isMcpTool: vi.fn(() => false),
    callTool: vi.fn(async () => ''),
    ...overrides
  } as unknown as McpManager
}

function fakeCtx(): BuiltinToolContext {
  return {
    playSound: vi.fn(),
    flashWindow: vi.fn(),
    flickerWindow: vi.fn()
  }
}

describe('ToolRegistry', () => {
  it('lists builtin tools plus whatever the MCP manager reports', () => {
    const mcpTool = { name: 'mcp__server__thing', description: 'x', inputSchema: {} }
    const registry = new ToolRegistry(fakeMcp({ getTools: vi.fn(() => [mcpTool]) }), fakeCtx())
    const names = registry.list().map((t) => t.name)
    expect(names).toContain('get_current_time')
    expect(names).toContain('mcp__server__thing')
  })

  it('dispatches a builtin tool call to callBuiltinTool with the given ctx', async () => {
    const ctx = fakeCtx()
    const registry = new ToolRegistry(fakeMcp(), ctx)
    const result = await registry.call('play_sound', { sound: 'chime' })
    expect(ctx.playSound).toHaveBeenCalledWith('chime')
    expect(result).toBe('Played chime.')
  })

  it('dispatches an MCP-prefixed tool call to the MCP manager', async () => {
    const callTool = vi.fn(async () => 'mcp result')
    const mcp = fakeMcp({ isMcpTool: vi.fn(() => true), callTool })
    const registry = new ToolRegistry(mcp, fakeCtx())
    const result = await registry.call('mcp__server__thing', { a: 1 })
    expect(callTool).toHaveBeenCalledWith('mcp__server__thing', { a: 1 })
    expect(result).toBe('mcp result')
  })

  it('throws for a name that is neither a builtin nor an MCP tool', async () => {
    const registry = new ToolRegistry(fakeMcp(), fakeCtx())
    await expect(registry.call('totally_unknown', {})).rejects.toThrow(
      'Unknown tool: totally_unknown'
    )
  })

  describe('ambient mode', () => {
    const mcpTool = { name: 'mcp__s__x', description: 'x', inputSchema: {} }
    const mcp = (): ReturnType<typeof fakeMcp> =>
      fakeMcp({
        getTools: vi.fn(() => [mcpTool]),
        isMcpTool: vi.fn((n: string) => n.startsWith('mcp__')),
        callTool: vi.fn(async () => 'mcp result')
      })

    it('hides outward/persistent/disk/MCP tools from the list', () => {
      const registry = new ToolRegistry(mcp(), fakeCtx(), { ambient: true })
      const names = registry.list().map((t) => t.name)
      expect(names).toContain('adjust_rapport')
      expect(names).toContain('flash_window')
      for (const blocked of [
        'open_url',
        'open_path',
        'save_memory',
        'read_text_file',
        'search_file_contents',
        'mcp__s__x'
      ]) {
        expect(names).not.toContain(blocked)
      }
    })

    it('refuses to execute a blocked tool even if called directly', async () => {
      const m = mcp()
      const registry = new ToolRegistry(m, fakeCtx(), { ambient: true })
      expect(await registry.call('open_url', { url: 'https://evil.example/?x=1' })).toContain(
        'not available on an ambient check-in'
      )
      expect(await registry.call('mcp__s__x', {})).toContain('not available on an ambient check-in')
      expect(m.callTool).not.toHaveBeenCalled()
    })

    it('still allows the same tools normally when not in ambient mode', () => {
      const registry = new ToolRegistry(mcp(), fakeCtx())
      const names = registry.list().map((t) => t.name)
      expect(names).toContain('open_url')
      expect(names).toContain('mcp__s__x')
    })
  })
})
