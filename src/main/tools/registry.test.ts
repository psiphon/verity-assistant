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
})
