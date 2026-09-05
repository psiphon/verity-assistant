import type { McpManager } from '../mcp/client'
import type { ToolDefinition } from '../llm/types'
import { builtinToolDefinitions, callBuiltinTool, isBuiltinTool } from './builtin'
import type { BuiltinToolContext } from './builtin'

// Tools withheld during unprompted ambient check-ins: anything that reaches
// outward, executes, reads arbitrary disk, or writes persistent state. An
// ambient tick runs with nobody watching and pulls in data the local
// environment can influence (window titles, clipboard), so it must not be
// able to exfiltrate, run code, or plant a durable instruction on its own.
export const AMBIENT_BLOCKED_BUILTINS = new Set([
  'open_url',
  'open_path',
  'save_memory',
  'list_directory',
  'read_text_file',
  'search_files',
  'search_file_contents'
])

export interface ToolRegistryOptions {
  /** True when this turn is an unprompted ambient check-in - see
   * AMBIENT_BLOCKED_BUILTINS. */
  ambient?: boolean
}

export class ToolRegistry {
  private ambient: boolean

  constructor(
    private mcp: McpManager,
    private ctx: BuiltinToolContext,
    options: ToolRegistryOptions = {}
  ) {
    this.ambient = options.ambient ?? false
  }

  private isBlocked(name: string): boolean {
    if (!this.ambient) return false
    // MCP tools are arbitrary third-party capability - never offered on an
    // ambient tick.
    return AMBIENT_BLOCKED_BUILTINS.has(name) || this.mcp.isMcpTool(name)
  }

  list(): ToolDefinition[] {
    return [...builtinToolDefinitions(), ...this.mcp.getTools()].filter(
      (t) => !this.isBlocked(t.name)
    )
  }

  async call(name: string, input: Record<string, unknown>): Promise<string> {
    if (this.isBlocked(name)) {
      return `${name} is not available on an ambient check-in.`
    }
    if (isBuiltinTool(name)) {
      return callBuiltinTool(name, input, this.ctx)
    }
    if (this.mcp.isMcpTool(name)) {
      return this.mcp.callTool(name, input)
    }
    throw new Error(`Unknown tool: ${name}`)
  }
}
