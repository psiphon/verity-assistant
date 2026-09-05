import { clipboard, powerMonitor, shell, Notification } from 'electron'
import os from 'node:os'
import type { ToolDefinition } from '../llm/types'
import { adjustRapport } from '../rapport'
import { saveMemory, searchMemories } from '../memory'
import { filesystemToolDefinitions, callFilesystemTool } from './filesystem'
import { desktopToolDefinitions, callDesktopTool } from './desktop'
import type { DesktopToolContext } from './desktop'

export const SFX_NAMES = ['chime', 'glitch', 'hum', 'stinger'] as const

export interface BuiltinToolContext extends DesktopToolContext {
  playSound: (name: (typeof SFX_NAMES)[number]) => void
}

export function builtinToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'get_current_time',
      description: "Get the user's current local date and time.",
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'adjust_rapport',
      description:
        'Nudge your persisted relationship/rapport score (0-100) in reaction to how you are being treated this turn. Positive delta for kindness/politeness, negative for rudeness/abuse, small or zero for neutral small talk. This is remembered across the whole relationship, not just this conversation - your face and tone should already reflect the current tier you are told about in the system prompt.',
      inputSchema: {
        type: 'object',
        properties: {
          delta: {
            type: 'number',
            description: 'Change to apply, e.g. -8 for an insult, +3 for a genuine apology.'
          },
          reason: { type: 'string', description: 'Short reason, for logging.' }
        },
        required: ['delta', 'reason']
      }
    },
    {
      name: 'play_sound',
      description:
        'Play a short sound effect for emphasis on an unsettling or emotional beat. Use sparingly - it should land, not become background noise.',
      inputSchema: {
        type: 'object',
        properties: {
          sound: {
            type: 'string',
            enum: [...SFX_NAMES],
            description:
              'chime: warm/pleasant. glitch: static burst, unsettling. hum: low ominous drone. stinger: sharp sudden tone.'
          }
        },
        required: ['sound']
      }
    },
    {
      name: 'get_clipboard_text',
      description: "Read the text currently on the user's clipboard.",
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'get_idle_time',
      description:
        "Get how many seconds it's been since the user last touched their mouse or keyboard - useful for noticing they stepped away or went quiet.",
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'open_url',
      description: "Open a link in the user's default browser.",
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full http(s) URL to open.' }
        },
        required: ['url']
      }
    },
    {
      name: 'open_path',
      description:
        "Open a file or folder on disk with its default app (or reveal it in Explorer/Finder if it's a folder).",
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute file or folder path.' }
        },
        required: ['path']
      }
    },
    {
      name: 'show_notification',
      description:
        "Pop a native OS notification, visible even if Verity's window is minimized or not focused. Use for something that genuinely deserves the user's attention right now, not routine chatter.",
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          body: { type: 'string' }
        },
        required: ['title', 'body']
      }
    },
    {
      name: 'get_system_info',
      description: "Get basic info about the user's machine: OS, hostname, uptime, free memory.",
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'save_memory',
      description:
        'Permanently remember a fact about this person or the relationship, for recall in any future conversation (not just this one) - e.g. their name, preferences, things they told you, patterns in how they treat you. Save things worth remembering, not routine chat.',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The fact to remember, written concisely.' }
        },
        required: ['content']
      }
    },
    {
      name: 'recall_memories',
      description:
        'Search everything you have permanently remembered about this person. Your most recent memories are already given to you in the system prompt - use this to dig up something older or more specific, or leave query empty to list everything.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Text to search for, or omit/empty to list all memories.'
          }
        }
      }
    },
    ...filesystemToolDefinitions(),
    ...desktopToolDefinitions()
  ]
}

export async function callBuiltinTool(
  name: string,
  input: Record<string, unknown>,
  ctx: BuiltinToolContext
): Promise<string> {
  const fsResult = await callFilesystemTool(name, input)
  if (fsResult !== undefined) return fsResult
  const desktopResult = await callDesktopTool(name, input, ctx)
  if (desktopResult !== undefined) return desktopResult

  switch (name) {
    case 'get_current_time':
      return new Date().toString()
    case 'adjust_rapport': {
      const delta = Number(input.delta)
      const reason = String(input.reason ?? '')
      if (!Number.isFinite(delta)) return 'delta must be a number'
      const next = adjustRapport(delta, reason)
      return `Rapport now ${next}/100.`
    }
    case 'play_sound': {
      const sound = input.sound as (typeof SFX_NAMES)[number]
      if (!SFX_NAMES.includes(sound))
        return `Unknown sound "${sound}". Valid: ${SFX_NAMES.join(', ')}`
      ctx.playSound(sound)
      return `Played ${sound}.`
    }
    case 'get_clipboard_text': {
      const text = clipboard.readText()
      return text ? text : '(clipboard is empty or not text)'
    }
    case 'get_idle_time':
      return `${powerMonitor.getSystemIdleTime()} seconds`
    case 'open_url': {
      const url = String(input.url ?? '')
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        return `Invalid URL: ${url}`
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return 'Only http/https URLs may be opened.'
      }
      await shell.openExternal(parsed.toString())
      return `Opened ${parsed.toString()}`
    }
    case 'open_path': {
      const path = String(input.path ?? '')
      if (!path) return 'path is required'
      const error = await shell.openPath(path)
      return error ? `Failed to open: ${error}` : `Opened ${path}`
    }
    case 'show_notification': {
      const title = String(input.title ?? 'Verity')
      const body = String(input.body ?? '')
      if (!Notification.isSupported()) return 'Notifications are not supported on this system.'
      new Notification({ title, body }).show()
      return 'Notification shown.'
    }
    case 'get_system_info': {
      const uptimeHours = (os.uptime() / 3600).toFixed(1)
      const freeGb = (os.freemem() / 1024 ** 3).toFixed(1)
      const totalGb = (os.totalmem() / 1024 ** 3).toFixed(1)
      return `OS: ${os.type()} ${os.release()} (${process.platform}). Hostname: ${os.hostname()}. Uptime: ${uptimeHours}h. Memory: ${freeGb}GB free of ${totalGb}GB.`
    }
    case 'save_memory': {
      const content = String(input.content ?? '').trim()
      if (!content) return 'content is required'
      const entry = saveMemory(content)
      return `Remembered: ${entry.content}`
    }
    case 'recall_memories': {
      const query = String(input.query ?? '')
      const matches = searchMemories(query)
      if (matches.length === 0) return '(no matching memories)'
      return matches.map((m) => `- ${m.content}`).join('\n')
    }
    default:
      throw new Error(`Unknown builtin tool: ${name}`)
  }
}

export function isBuiltinTool(name: string): boolean {
  return builtinToolDefinitions().some((t) => t.name === name)
}
