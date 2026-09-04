import { ipcMain, BrowserWindow, shell } from 'electron'
import { IPC } from '@shared/ipc'
import type { AppSettings } from '@shared/types'
import { settingsStore } from './store'
import { createProvider } from './llm'
import type { ChatMessage } from './llm/types'
import { McpManager } from './mcp/client'
import { ToolRegistry } from './tools/registry'
import { runAgentTurn, buildSystemPrompt } from './agent/loop'
import { log, getLogPath } from './logger'
import { WINDOW_SIZE } from './windowConfig'
import { getRapport, getTier, resetRapport, onRapportChanged } from './rapport'
import { formatMemoriesForPrompt, getMemories, deleteMemory, clearMemories } from './memory'

const mcp = new McpManager()
let history: ChatMessage[] = []

export async function initAgentBackend(): Promise<void> {
  const settings = settingsStore.store
  log.info('mcp', `Connecting ${settings.mcpServers.length} configured MCP server(s)`)
  await mcp.connectAll(settings.mcpServers)
  logMcpStatuses()
}

function logMcpStatuses(): void {
  for (const status of mcp.getStatuses()) {
    if (status.connected) {
      log.info('mcp', `Connected: ${status.name} (${status.toolCount} tools)`)
    } else {
      log.error('mcp', `Failed to connect: ${status.name}`, status.error)
    }
  }
}

function getWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

function playSound(name: string): void {
  log.info('sfx', `play_sound(${name})`)
  getWindow()?.webContents.send(IPC.chatPlaySound, name)
}

export function registerIpcHandlers(): void {
  // The face is driven live by rapport (see faceAtlas.ts on the renderer
  // side), so every viewer needs to hear about a change the moment the
  // model calls adjust_rapport, not just next time Settings happens to poll.
  onRapportChanged((value) => {
    getWindow()?.webContents.send(IPC.rapportChanged, { value, tierLabel: getTier(value).label })
  })

  ipcMain.handle(IPC.settingsGet, (): AppSettings => settingsStore.store)

  ipcMain.handle(IPC.settingsSet, async (_e, settings: AppSettings) => {
    log.info('settings', `Settings saved (provider=${settings.activeProvider})`)
    settingsStore.set(settings)
    await mcp.connectAll(settings.mcpServers)
    logMcpStatuses()
    getWindow()?.webContents.send(IPC.mcpStatuses, mcp.getStatuses())
  })

  ipcMain.handle(IPC.mcpStatuses, () => mcp.getStatuses())

  ipcMain.handle(IPC.mcpReload, async () => {
    log.info('mcp', 'Manual MCP reload requested')
    await mcp.connectAll(settingsStore.store.mcpServers)
    logMcpStatuses()
    return mcp.getStatuses()
  })

  ipcMain.handle(IPC.chatSend, async (event, userText: string) => {
    const settings = settingsStore.store
    const providerSettings = settings.providers[settings.activeProvider]
    const win = BrowserWindow.fromWebContents(event.sender)

    log.info('chat', `User -> ${settings.activeProvider}: ${truncate(userText)}`)
    win?.webContents.send(IPC.chatThinking, true)

    try {
      const provider = createProvider(settings.activeProvider, {
        apiKey: providerSettings.apiKey,
        baseUrl: providerSettings.baseUrl || undefined,
        model: providerSettings.model || undefined
      })
      const registry = new ToolRegistry(mcp, { playSound })
      const rapport = getRapport()
      const tier = getTier(rapport)
      const system = buildSystemPrompt(
        settings.systemPrompt,
        rapport,
        tier.label,
        tier.description,
        formatMemoriesForPrompt()
      )

      const { text, history: newHistory } = await runAgentTurn(
        provider,
        registry,
        history,
        userText,
        system,
        {
          onToolCall: (name, input, fallbackParsed) => {
            if (fallbackParsed) {
              log.info(
                'tool',
                `Fallback-parsed ${name} out of raw reply text (model isn't using real tool-calling)`,
                input
              )
            } else {
              log.info('tool', `Calling ${name}`, input)
            }
            win?.webContents.send(IPC.chatToolCall, { name, input })
          }
        }
      )
      history = newHistory

      log.info('chat', `${settings.activeProvider} -> assistant: ${truncate(text)}`)
      win?.webContents.send(IPC.chatMessage, text)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('chat', `${settings.activeProvider} request failed`, err)
      win?.webContents.send(IPC.chatError, message)
    } finally {
      win?.webContents.send(IPC.chatThinking, false)
    }
  })

  ipcMain.handle(IPC.windowToggleAlwaysOnTop, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    const next = !win.isAlwaysOnTop()
    win.setAlwaysOnTop(next)
    settingsStore.set('alwaysOnTop', next)
    return next
  })

  // Dragging is done manually from the renderer (mouse deltas -> setPosition)
  // rather than via CSS -webkit-app-region: drag, which on Windows swallows
  // the click event entirely when the drag region and click target are the
  // same element - it never distinguishes "clicked" from "pressed and let go".
  //
  // setBounds (not setPosition) re-asserts the fixed width/height alongside
  // every position update, in one atomic call, on every pointermove during
  // the drag - not just reactively after something else has already resized
  // it. minWidth=maxWidth alone wasn't holding during an actual live drag.
  ipcMain.on(IPC.windowGetPosition, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    event.returnValue = win ? win.getPosition() : [0, 0]
  })

  ipcMain.on(IPC.windowSetPosition, (event, x: number, y: number) => {
    BrowserWindow.fromWebContents(event.sender)?.setBounds({
      x: Math.round(x),
      y: Math.round(y),
      width: WINDOW_SIZE.width,
      height: WINDOW_SIZE.height
    })
  })

  ipcMain.handle(IPC.rapportGet, () => {
    const value = getRapport()
    return { value, tierLabel: getTier(value).label }
  })

  ipcMain.handle(IPC.rapportReset, () => {
    log.info('rapport', 'Manual reset requested from Settings')
    const value = resetRapport()
    return { value, tierLabel: getTier(value).label }
  })

  ipcMain.handle(IPC.memoriesGet, () => getMemories())

  ipcMain.handle(IPC.memoriesDelete, (_e, id: string) => {
    deleteMemory(id)
    return getMemories()
  })

  ipcMain.handle(IPC.memoriesClear, () => {
    log.info('memory', 'Manual clear requested from Settings')
    clearMemories()
    return getMemories()
  })

  ipcMain.handle(IPC.logsGetPath, () => getLogPath())

  ipcMain.handle(IPC.logsOpenFolder, () => {
    shell.showItemInFolder(getLogPath())
  })

  ipcMain.on(IPC.logsRendererError, (_e, message: string) => {
    log.error('renderer', message)
  })
}

function truncate(text: string, max = 500): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}
