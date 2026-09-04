import type { McpManager } from '../mcp/client'
import type { ToolDefinition } from '../llm/types'
import { builtinToolDefinitions, callBuiltinTool, isBuiltinTool } from './builtin'
import type { BuiltinToolContext } from './builtin'

export class ToolRegistry {
  constructor(
    private mcp: McpManager,
    private ctx: BuiltinToolContext
  ) {}

  list(): ToolDefinition[] {
    return [...builtinToolDefinitions(), ...this.mcp.getTools()]
  }

  async call(name: string, input: Record<string, unknown>): Promise<string> {
    if (isBuiltinTool(name)) {
      return callBuiltinTool(name, input, this.ctx)
    }
    if (this.mcp.isMcpTool(name)) {
      return this.mcp.callTool(name, input)
    }
    throw new Error(`Unknown tool: ${name}`)
  }
}
