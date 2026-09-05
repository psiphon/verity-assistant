import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServerConfig } from '@shared/types'

// A brand new Client instance is constructed on every connectOne() call, so
// per-instance mock overrides (set after construction) would only ever
// affect an instance that's already been discarded by the next connectAll.
// Routing every instance's methods through this shared, mutable object lets
// a test configure behavior *before* connecting and have it actually apply.
const { clientInstances, transportInstances, mockDefaults, MockClient, MockTransport } = vi.hoisted(
  () => {
    const clientInstances: InstanceType<typeof MockClient>[] = []
    const transportInstances: InstanceType<typeof MockTransport>[] = []
    const mockDefaults = {
      connect: async (): Promise<void> => {},
      listTools: async (): Promise<{ tools: unknown[] }> => ({ tools: [] }),
      callTool: async (): Promise<unknown> => ({ content: [] }),
      close: async (): Promise<void> => {}
    }
    class MockClient {
      connect = vi.fn((...args: unknown[]) => mockDefaults.connect(...(args as [])))
      listTools = vi.fn((...args: unknown[]) => mockDefaults.listTools(...(args as [])))
      callTool = vi.fn((...args: unknown[]) => mockDefaults.callTool(...(args as [])))
      close = vi.fn((...args: unknown[]) => mockDefaults.close(...(args as [])))
      constructor(public info: unknown) {
        clientInstances.push(this)
      }
    }
    class MockTransport {
      constructor(public opts: unknown) {
        transportInstances.push(this)
      }
    }
    return { clientInstances, transportInstances, mockDefaults, MockClient, MockTransport }
  }
)

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: MockClient }))
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: MockTransport
}))

import { McpManager } from './client'

function server(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 's1',
    name: 'my-server',
    command: 'npx',
    args: ['-y', 'thing'],
    enabled: true,
    ...overrides
  }
}

beforeEach(() => {
  mockDefaults.connect = async () => {}
  mockDefaults.listTools = async () => ({ tools: [] })
  mockDefaults.callTool = async () => ({ content: [] })
  mockDefaults.close = async () => {}
})

describe('McpManager', () => {
  it('starts with no tools and no statuses', () => {
    const mgr = new McpManager()
    expect(mgr.getTools()).toEqual([])
    expect(mgr.getStatuses()).toEqual([])
  })

  it('skips disabled servers entirely', async () => {
    const mgr = new McpManager()
    await mgr.connectAll([server({ enabled: false })])
    expect(mgr.getStatuses()).toEqual([])
    expect(clientInstances).toHaveLength(0)
  })

  it('connects an enabled server and namespaces/prefixes its tools', async () => {
    mockDefaults.listTools = async () => ({
      tools: [{ name: 'do_thing', description: 'does a thing', inputSchema: { type: 'object' } }]
    })
    const mgr = new McpManager()
    await mgr.connectAll([server()])

    expect(mgr.getTools()).toEqual([
      {
        name: 'mcp__s1__do_thing',
        description: '[my-server] does a thing',
        inputSchema: { type: 'object' }
      }
    ])
    expect(mgr.getStatuses()).toEqual([
      { id: 's1', name: 'my-server', connected: true, toolCount: 1, error: undefined }
    ])
  })

  it('falls back to the tool name as description when the server gives none', async () => {
    mockDefaults.listTools = async () => ({ tools: [{ name: 'do_thing', inputSchema: {} }] })
    const mgr = new McpManager()
    await mgr.connectAll([server()])
    expect(mgr.getTools()[0].description).toBe('[my-server] do_thing')
  })

  it('records a connection failure as a disconnected status with the error message', async () => {
    mockDefaults.connect = async () => {
      throw new Error('spawn failed')
    }
    const mgr = new McpManager()
    await mgr.connectAll([server()])

    expect(mgr.getTools()).toEqual([])
    expect(mgr.getStatuses()).toEqual([
      { id: 's1', name: 'my-server', connected: false, toolCount: 0, error: 'spawn failed' }
    ])
  })

  it('stringifies a non-Error thrown during connect', async () => {
    mockDefaults.connect = async () => {
      throw 'just a string' as unknown as Error
    }
    const mgr = new McpManager()
    await mgr.connectAll([server()])
    expect(mgr.getStatuses()[0].error).toBe('just a string')
  })

  it('disconnects previous connections before establishing new ones', async () => {
    const mgr = new McpManager()
    await mgr.connectAll([server({ id: 's1' })])
    const first = clientInstances.at(-1)!
    await mgr.connectAll([server({ id: 's2' })])
    expect(first.close).toHaveBeenCalled()
    expect(mgr.getStatuses().map((s) => s.id)).toEqual(['s2'])
  })

  it('disconnectAll swallows a rejecting close() instead of throwing', async () => {
    const mgr = new McpManager()
    await mgr.connectAll([server()])
    clientInstances.at(-1)!.close.mockRejectedValue(new Error('already closed'))
    await expect(mgr.disconnectAll()).resolves.toBeUndefined()
    expect(mgr.getStatuses()).toEqual([])
  })

  describe('isMcpTool', () => {
    it('is true for an mcp__-prefixed name and false otherwise', () => {
      const mgr = new McpManager()
      expect(mgr.isMcpTool('mcp__s1__do_thing')).toBe(true)
      expect(mgr.isMcpTool('get_current_time')).toBe(false)
    })
  })

  describe('callTool', () => {
    it('routes to the right connection and joins text content blocks', async () => {
      const mgr = new McpManager()
      await mgr.connectAll([server()])
      clientInstances.at(-1)!.callTool.mockResolvedValue({
        content: [
          { type: 'text', text: 'first' },
          { type: 'text', text: 'second' }
        ]
      })
      const result = await mgr.callTool('mcp__s1__do_thing', { a: 1 })
      expect(clientInstances.at(-1)!.callTool).toHaveBeenCalledWith({
        name: 'do_thing',
        arguments: { a: 1 }
      })
      expect(result).toBe('first\nsecond')
    })

    it('describes non-text content blocks by type', async () => {
      const mgr = new McpManager()
      await mgr.connectAll([server()])
      clientInstances.at(-1)!.callTool.mockResolvedValue({ content: [{ type: 'image' }] })
      const result = await mgr.callTool('mcp__s1__do_thing', {})
      expect(result).toBe('[image content]')
    })

    it('falls back to JSON.stringify when there is no content array', async () => {
      const mgr = new McpManager()
      await mgr.connectAll([server()])
      clientInstances.at(-1)!.callTool.mockResolvedValue({ ok: true })
      const result = await mgr.callTool('mcp__s1__do_thing', {})
      expect(result).toBe(JSON.stringify({ ok: true }))
    })

    it('throws for an unknown server id embedded in the tool name', async () => {
      const mgr = new McpManager()
      await expect(mgr.callTool('mcp__nope__do_thing', {})).rejects.toThrow(
        'Unknown MCP server for tool mcp__nope__do_thing'
      )
    })
  })

  it('merges per-server env on top of process env when connecting', async () => {
    const mgr = new McpManager()
    await mgr.connectAll([server({ env: { FOO: 'bar' } })])
    const transport = transportInstances.at(-1)! as { opts: { env: Record<string, string> } }
    expect(transport.opts.env.FOO).toBe('bar')
  })
})
