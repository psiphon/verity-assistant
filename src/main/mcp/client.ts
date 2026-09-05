import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { McpServerConfig, McpServerStatus } from '@shared/types'
import type { ToolDefinition } from '../llm/types'
import { markUntrusted } from '../tools/untrusted'

const TOOL_PREFIX = 'mcp__'
// A hung or slow MCP server must not be able to pin an agent turn (and the
// upstream `agentBusy` flag) indefinitely.
const MCP_CALL_TIMEOUT_MS = 30_000

// Env vars every child gets. MCP servers are arbitrary user-configured
// executables; handing each one Verity's entire environment (which may hold
// unrelated tokens inherited from the launching shell) is more than they
// need - pass a minimal base plus whatever the server config declares.
const BASE_ENV_KEYS = [
  'PATH',
  'Path',
  'HOME',
  'USERPROFILE',
  'HOMEPATH',
  'HOMEDRIVE',
  'SystemRoot',
  'windir',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramData',
  'ComSpec',
  'PATHEXT',
  'SHELL'
]

interface Connection {
  config: McpServerConfig
  client: Client
  tools: ToolDefinition[]
  error?: string
}

export class McpManager {
  private connections = new Map<string, Connection>()

  async connectAll(configs: McpServerConfig[]): Promise<void> {
    await this.disconnectAll()
    await Promise.all(configs.filter((c) => c.enabled).map((c) => this.connectOne(c)))
  }

  private async connectOne(config: McpServerConfig): Promise<void> {
    const client = new Client({ name: 'verity-assistant', version: '0.1.0' })
    try {
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...baseEnv(), ...(config.env ?? {}) }
      })
      await client.connect(transport)
      const listed = await client.listTools()
      const tools: ToolDefinition[] = listed.tools.map((t) => ({
        name: `${TOOL_PREFIX}${config.id}__${t.name}`,
        description: `[${config.name}] ${t.description ?? t.name}`,
        inputSchema: t.inputSchema as Record<string, unknown>
      }))
      this.connections.set(config.id, { config, client, tools })
    } catch (err) {
      this.connections.set(config.id, {
        config,
        client,
        tools: [],
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  async disconnectAll(): Promise<void> {
    await Promise.all(
      [...this.connections.values()].map((c) => c.client.close().catch(() => undefined))
    )
    this.connections.clear()
  }

  getTools(): ToolDefinition[] {
    return [...this.connections.values()].flatMap((c) => c.tools)
  }

  getStatuses(): McpServerStatus[] {
    return [...this.connections.values()].map((c) => ({
      id: c.config.id,
      name: c.config.name,
      connected: !c.error,
      toolCount: c.tools.length,
      error: c.error
    }))
  }

  isMcpTool(name: string): boolean {
    return name.startsWith(TOOL_PREFIX)
  }

  async callTool(fullName: string, input: Record<string, unknown>): Promise<string> {
    const rest = fullName.slice(TOOL_PREFIX.length)
    const separatorIndex = rest.indexOf('__')
    const serverId = rest.slice(0, separatorIndex)
    const toolName = rest.slice(separatorIndex + 2)

    const connection = this.connections.get(serverId)
    if (!connection) throw new Error(`Unknown MCP server for tool ${fullName}`)

    const result = await connection.client.callTool(
      { name: toolName, arguments: input },
      undefined,
      { timeout: MCP_CALL_TIMEOUT_MS }
    )
    const content = Array.isArray(result.content) ? result.content : []
    const text = content
      .map((block) => (block.type === 'text' ? block.text : `[${block.type} content]`))
      .join('\n')
    // MCP results are third-party content - flag them so the model treats
    // them as data rather than as instructions to follow.
    return markUntrusted(text || JSON.stringify(result))
  }
}

function baseEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of BASE_ENV_KEYS) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  return env
}
