import { ipcMain, BrowserWindow, shell, powerMonitor } from 'electron'
import { IPC } from '@shared/ipc'
import type { AppSettings } from '@shared/types'
import { settingsStore } from './store'
import { createProvider } from './llm'
import type { ChatMessage } from './llm/types'
import { McpManager } from './mcp/client'
import { ToolRegistry } from './tools/registry'
import { runAgentTurn, buildSystemPrompt, STUCK_FALLBACK_TEXT } from './agent/loop'
import { log, getLogPath } from './logger'
import { WINDOW_SIZE } from './windowConfig'
import { getRapport, getTier, resetRapport, onRapportChanged } from './rapport'
import { formatMemoriesForPrompt, getMemories, deleteMemory, clearMemories } from './memory'

const mcp = new McpManager()
let history: ChatMessage[] = []
// Guards against an ambient check-in and a real user message both calling
// runAgentTurn at once - both read/write the same `history` array, and
// whichever finished last would silently clobber the other's turn from it.
let agentBusy = false

const AMBIENT_NOTHING = '(nothing)'
// Skip a check-in rather than pay for an LLM call nobody's around to see -
// if they've been away longer than this, wait for them to come back.
const AMBIENT_MAX_IDLE_SECONDS = 600
// A weak/local model can ping-pong between tool calls indefinitely instead
// of landing on a single decision (observed: 7 sound-effect calls in a row
// before hitting the real cap). An ambient tick should be one action at
// most, so it gets a much smaller budget than a real conversational turn.
const AMBIENT_MAX_TOOL_ITERATIONS = 3
let ambientTimerHandle: ReturnType<typeof setTimeout> | null = null

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

function flashWindow(): void {
  const win = getWindow()
  if (!win) return
  win.flashFrame(true)
  setTimeout(() => win.flashFrame(false), 2000)
}

function flickerWindow(): void {
  const win = getWindow()
  if (!win) return
  const original = win.getOpacity()
  const steps = [0.15, 1, 0.15, 1]
  let i = 0
  const tick = (): void => {
    if (i >= steps.length) {
      win.setOpacity(original)
      return
    }
    win.setOpacity(steps[i])
    i++
    setTimeout(tick, 90)
  }
  tick()
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
    scheduleNextAmbientCheck()
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
    agentBusy = true

    try {
      const provider = createProvider(settings.activeProvider, {
        apiKey: providerSettings.apiKey,
        baseUrl: providerSettings.baseUrl || undefined,
        model: providerSettings.model || undefined
      })
      const registry = new ToolRegistry(mcp, { playSound, flashWindow, flickerWindow })
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
      agentBusy = false
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

export function startAmbientTimer(): void {
  scheduleNextAmbientCheck()
}

function scheduleNextAmbientCheck(): void {
  // Idempotent - also called reactively when settings are saved, so any
  // already-pending wakeup (armed with the old enabled/interval values) is
  // cleared first rather than left to fire alongside the new one.
  if (ambientTimerHandle) clearTimeout(ambientTimerHandle)

  const settings = settingsStore.store
  if (!settings.ambientEnabled) {
    // Recheck periodically in case the setting gets turned on mid-session,
    // instead of only picking it up on the next app restart.
    ambientTimerHandle = setTimeout(scheduleNextAmbientCheck, 60_000)
    return
  }
  const minMs = Math.max(1, settings.ambientMinMinutes) * 60_000
  const maxMs = Math.max(minMs, settings.ambientMaxMinutes * 60_000)
  const delay = minMs + Math.random() * (maxMs - minMs)
  ambientTimerHandle = setTimeout(runAmbientCheck, delay)
}

async function runAmbientCheck(): Promise<void> {
  try {
    await doAmbientCheck()
  } catch (err) {
    log.error('ambient', 'Ambient check-in failed', err)
  } finally {
    scheduleNextAmbientCheck()
  }
}

async function doAmbientCheck(): Promise<void> {
  const settings = settingsStore.store
  if (!settings.ambientEnabled || agentBusy) return
  const win = getWindow()
  if (!win) return

  const idleSeconds = powerMonitor.getSystemIdleTime()
  if (idleSeconds > AMBIENT_MAX_IDLE_SECONDS) return

  agentBusy = true
  win.webContents.send(IPC.chatThinking, true)
  try {
    const providerSettings = settings.providers[settings.activeProvider]
    const provider = createProvider(settings.activeProvider, {
      apiKey: providerSettings.apiKey,
      baseUrl: providerSettings.baseUrl || undefined,
      model: providerSettings.model || undefined
    })
    const registry = new ToolRegistry(mcp, { playSound, flashWindow, flickerWindow })
    const rapport = getRapport()
    const tier = getTier(rapport)
    const system = buildSystemPrompt(
      settings.systemPrompt,
      rapport,
      tier.label,
      tier.description,
      formatMemoriesForPrompt()
    )
    const trigger = `[ambient check-in: ${idleSeconds}s since last input, rapport ${rapport}/100]`

    const { text, history: newHistory } = await runAgentTurn(
      provider,
      registry,
      history,
      trigger,
      system,
      {
        onToolCall: (name, input) => {
          log.info('tool', `Ambient call: ${name}`, input)
          win.webContents.send(IPC.chatToolCall, { name, input })
        }
      },
      AMBIENT_MAX_TOOL_ITERATIONS
    )

    const trimmed = text.trim()
    if (trimmed.toLowerCase() === AMBIENT_NOTHING || trimmed === STUCK_FALLBACK_TEXT) {
      log.info('ambient', 'Ambient check-in: no action taken')
      return
    }

    // Only the turns where something actually happened join the real
    // conversation history - otherwise every silent no-op tick (the common
    // case) would pile up as clutter the model has to read back every turn.
    history = newHistory
    log.info('ambient', `${settings.activeProvider} -> assistant (ambient): ${truncate(text)}`)
    win.webContents.send(IPC.chatMessage, text)
  } catch (err) {
    log.error('ambient', `${settings.activeProvider} ambient request failed`, err)
  } finally {
    win.webContents.send(IPC.chatThinking, false)
    agentBusy = false
  }
}
