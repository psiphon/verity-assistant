import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { McpServerConfig, McpServerStatus } from '@shared/types'
import type { ToolDefinition } from '../llm/types'

const TOOL_PREFIX = 'mcp__'

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
        env: { ...processEnv(), ...(config.env ?? {}) }
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

    const result = await connection.client.callTool({ name: toolName, arguments: input })
    const content = Array.isArray(result.content) ? result.content : []
    const text = content
      .map((block) => (block.type === 'text' ? block.text : `[${block.type} content]`))
      .join('\n')
    return text || JSON.stringify(result)
  }
}

function processEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  return env
}
