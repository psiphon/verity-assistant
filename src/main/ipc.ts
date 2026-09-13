import { ipcMain, BrowserWindow, shell, powerMonitor } from 'electron'
import { IPC } from '@shared/ipc'
import type { AppSettings } from '@shared/types'
import { settingsStore } from './store'
import { decryptSettingsSecrets, encryptSettingsSecrets } from './secrets'
import { createProvider } from './llm'
import type { ChatMessage } from './llm/types'
import { McpManager } from './mcp/client'
import { ToolRegistry } from './tools/registry'
import { runAgentTurn, buildSystemPrompt, STUCK_FALLBACK_TEXT, isNothingReply } from './agent/loop'
import { synthesizeFishAudio } from './tts'
import { log, getLogPath } from './logger'
import { WINDOW_SIZE } from './windowConfig'
import { getRapport, getTier, resetRapport, onRapportChanged, getRapportHistory } from './rapport'
import { logActivity, getActivity, clearActivity } from './activity'
import { getReminders, cancelReminder } from './reminders'
import { formatMemoriesForPrompt, getMemories, deleteMemory, clearMemories } from './memory'
import {
  trimHistory,
  getWorkingHistory,
  setWorkingHistory,
  getTranscript,
  appendTranscript,
  clearConversation
} from './conversation'

const mcp = new McpManager()
// Seeded from disk so the LLM's context survives a restart instead of
// starting the relationship over from nothing every launch.
let history: ChatMessage[] = getWorkingHistory()

function finiteOr(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

// Persisted settings hold secret fields encrypted (see secrets.ts) - always
// read them through this so callers get usable plaintext.
function currentSettings(): AppSettings {
  return decryptSettingsSecrets(settingsStore.store)
}
// Guards against an ambient check-in and a real user message both calling
// runAgentTurn at once - both read/write the same `history` array, and
// whichever finished last would silently clobber the other's turn from it.
let agentBusy = false

// Skip a check-in rather than pay for an LLM call nobody's around to see -
// if they've been away longer than this, wait for them to come back.
const AMBIENT_MAX_IDLE_SECONDS = 600
// ...and skip it if they were active more recently than this. An "unprompted"
// remark seconds after the conversation was live isn't ambient - it just
// makes a weak model continue or re-speak the exchange that's still on screen.
const AMBIENT_MIN_IDLE_SECONDS = 90
// The last line actually shown/spoken to the user. An ambient tick that comes
// back with the same text (a model latching onto recent context) is dropped
// rather than read aloud again.
let lastDeliveredText = ''
// A weak/local model can ping-pong between tool calls indefinitely instead
// of landing on a single decision (observed: 7 sound-effect calls in a row
// before hitting the real cap). An ambient tick should be one action at
// most, so it gets a much smaller budget than a real conversational turn.
const AMBIENT_MAX_TOOL_ITERATIONS = 3
let ambientTimerHandle: ReturnType<typeof setTimeout> | null = null

export async function initAgentBackend(): Promise<void> {
  // Migrate any pre-existing plaintext secrets to encrypted-at-rest on first
  // launch after upgrade (no-op once everything is already tagged, or if the
  // platform has no safeStorage backend).
  settingsStore.set(encryptSettingsSecrets(settingsStore.store))

  const settings = currentSettings()
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

let windowPositionSaveTimer: ReturnType<typeof setTimeout> | null = null
const WINDOW_POSITION_SAVE_DEBOUNCE_MS = 300

// A drag fires this on every pointermove - writing to disk that often would
// be a lot of needless I/O for a value nothing reads until the next launch,
// so only the position after movement settles actually gets persisted.
function scheduleWindowPositionSave(x: number, y: number): void {
  if (windowPositionSaveTimer) clearTimeout(windowPositionSaveTimer)
  windowPositionSaveTimer = setTimeout(() => {
    settingsStore.set({ windowX: x, windowY: y })
  }, WINDOW_POSITION_SAVE_DEBOUNCE_MS)
}

export function registerIpcHandlers(): void {
  // The face is driven live by rapport (see faceAtlas.ts on the renderer
  // side), so every viewer needs to hear about a change the moment the
  // model calls adjust_rapport, not just next time Settings happens to poll.
  onRapportChanged((value) => {
    getWindow()?.webContents.send(IPC.rapportChanged, { value, tierLabel: getTier(value).label })
  })

  ipcMain.handle(IPC.settingsGet, (): AppSettings => currentSettings())

  ipcMain.handle(IPC.settingsSet, async (_e, settings: AppSettings) => {
    if (!isPlausibleSettings(settings)) {
      log.error('settings', 'Rejected a malformed settings payload')
      return
    }
    log.info('settings', `Settings saved (provider=${settings.activeProvider})`)
    settingsStore.set(encryptSettingsSecrets(settings))
    scheduleNextAmbientCheck()
    await mcp.connectAll(currentSettings().mcpServers)
    logMcpStatuses()
    getWindow()?.webContents.send(IPC.mcpStatuses, mcp.getStatuses())
  })

  // Renderer-side TTS asks for audio here when the Fish Audio engine is
  // selected; main does the HTTP call so the bearer token and the outbound
  // request never touch a browser context. Returns null on any failure - the
  // renderer then falls back to the system voice rather than going mute.
  ipcMain.handle(IPC.ttsSynthesize, async (_e, text: unknown) => {
    const settings = currentSettings()
    if (settings.ttsEngine !== 'fish') return null
    const clean = typeof text === 'string' ? text.trim() : ''
    if (!clean) return null
    try {
      const data = await synthesizeFishAudio(clean, settings.fishAudio)
      log.info('tts', `Fish Audio synthesized ${data.byteLength} bytes`)
      return { format: settings.fishAudio.format, data }
    } catch (err) {
      log.error('tts', 'Fish Audio synthesis failed', err)
      return null
    }
  })

  ipcMain.handle(IPC.mcpStatuses, () => mcp.getStatuses())

  ipcMain.handle(IPC.mcpReload, async () => {
    log.info('mcp', 'Manual MCP reload requested')
    await mcp.connectAll(currentSettings().mcpServers)
    logMcpStatuses()
    return mcp.getStatuses()
  })

  ipcMain.handle(IPC.chatSend, async (event, userText: string) => {
    const settings = currentSettings()
    const providerSettings = settings.providers[settings.activeProvider]
    const win = BrowserWindow.fromWebContents(event.sender)

    // One agent turn at a time - a second send (or an ambient tick) landing
    // mid-turn would race on the shared `history` array and silently drop one
    // turn's messages.
    if (agentBusy) {
      win?.webContents.send(
        IPC.chatError,
        'Still finishing the previous message - give it a moment.'
      )
      return
    }

    log.info('chat', `User -> ${settings.activeProvider}: ${truncate(userText)}`)
    appendTranscript({ role: 'user', text: userText })
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
                { args: Object.keys(input) }
              )
            } else {
              log.info('tool', `Calling ${name}`, { args: Object.keys(input) })
            }
            logActivity(name, input)
            win?.webContents.send(IPC.chatToolCall, { name, input })
          }
        }
      )
      history = trimHistory(newHistory)
      setWorkingHistory(history)

      if (isNothingReply(text)) {
        // The `(nothing)` sentinel is only meaningful for ambient ticks; if
        // the model emits it in reply to a real message, swallow it rather
        // than read "(nothing)" aloud.
        log.warn('chat', `${settings.activeProvider} -> assistant: no-op sentinel reply, dropped`)
      } else {
        log.info('chat', `${settings.activeProvider} -> assistant: ${truncate(text)}`)
        lastDeliveredText = text
        appendTranscript({ role: 'assistant', text })
        win?.webContents.send(IPC.chatMessage, text)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('chat', `${settings.activeProvider} request failed`, err)
      appendTranscript({ role: 'system', text: `Error: ${message}` })
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
    const rx = Math.round(x)
    const ry = Math.round(y)
    BrowserWindow.fromWebContents(event.sender)?.setBounds({
      x: rx,
      y: ry,
      width: WINDOW_SIZE.width,
      height: WINDOW_SIZE.height
    })
    scheduleWindowPositionSave(rx, ry)
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

  ipcMain.handle(IPC.rapportHistoryGet, () => getRapportHistory())

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

  ipcMain.handle(IPC.conversationGet, () => getTranscript())

  ipcMain.handle(IPC.conversationClear, (event) => {
    log.info('chat', 'Manual conversation clear requested from Settings')
    clearConversation()
    history = []
    lastDeliveredText = ''
    BrowserWindow.fromWebContents(event.sender)?.webContents.send(IPC.conversationCleared)
  })

  ipcMain.handle(IPC.activityGet, () => getActivity())

  ipcMain.handle(IPC.activityClear, () => {
    log.info('activity', 'Manual clear requested from Settings')
    clearActivity()
    return getActivity()
  })

  ipcMain.handle(IPC.remindersGet, () => getReminders())

  ipcMain.handle(IPC.remindersCancel, (_e, id: string) => {
    log.info('reminders', `Manual cancel requested from Settings: ${id}`)
    return cancelReminder(id)
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

// Loose equality for "the model just said this same thing again" - ignores
// case, whitespace and trailing punctuation so a re-emitted line still counts.
function sameLine(a: string, b: string): boolean {
  const norm = (s: string): string =>
    s
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[.!?,;:'"]+/g, '')
      .trim()
  const na = norm(a)
  return na.length > 0 && na === norm(b)
}

// Structural sanity check on a settings payload from the renderer before it's
// persisted wholesale (which includes the MCP server list that gets spawned).
// Not a full schema - just enough to reject an obviously wrong shape.
function isPlausibleSettings(s: unknown): s is AppSettings {
  if (typeof s !== 'object' || s === null) return false
  const o = s as Record<string, unknown>
  return (
    typeof o.providers === 'object' &&
    o.providers !== null &&
    Array.isArray(o.mcpServers) &&
    typeof o.activeProvider === 'string' &&
    (o.mcpServers as unknown[]).every(
      (m) =>
        typeof m === 'object' &&
        m !== null &&
        typeof (m as Record<string, unknown>).command === 'string' &&
        Array.isArray((m as Record<string, unknown>).args)
    )
  )
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
  // Clamp both bounds to [1 min, 24 h] and coerce non-finite values (a
  // cleared/garbled settings field) to the defaults - otherwise a NaN here
  // becomes setTimeout(NaN), which fires immediately and turns ambient
  // check-ins into a hot loop of paid LLM calls.
  const minMinutes = Math.min(1440, Math.max(1, finiteOr(settings.ambientMinMinutes, 10)))
  const maxMinutes = Math.min(1440, Math.max(minMinutes, finiteOr(settings.ambientMaxMinutes, 30)))
  const minMs = minMinutes * 60_000
  const maxMs = maxMinutes * 60_000
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
  const settings = currentSettings()
  if (!settings.ambientEnabled || agentBusy) return
  const win = getWindow()
  if (!win) return

  const idleSeconds = powerMonitor.getSystemIdleTime()
  if (idleSeconds > AMBIENT_MAX_IDLE_SECONDS || idleSeconds < AMBIENT_MIN_IDLE_SECONDS) return

  agentBusy = true
  win.webContents.send(IPC.chatThinking, true)
  try {
    const providerSettings = settings.providers[settings.activeProvider]
    const provider = createProvider(settings.activeProvider, {
      apiKey: providerSettings.apiKey,
      baseUrl: providerSettings.baseUrl || undefined,
      model: providerSettings.model || undefined
    })
    const registry = new ToolRegistry(
      mcp,
      { playSound, flashWindow, flickerWindow },
      { ambient: true }
    )
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
          log.info('tool', `Ambient call: ${name}`, { args: Object.keys(input) })
          logActivity(name, input)
          win.webContents.send(IPC.chatToolCall, { name, input })
        }
      },
      AMBIENT_MAX_TOOL_ITERATIONS
    )

    if (isNothingReply(text) || text.trim() === STUCK_FALLBACK_TEXT) {
      log.info('ambient', 'Ambient check-in: no action taken')
      return
    }
    if (sameLine(text, lastDeliveredText)) {
      // The model just re-emitted its previous line instead of doing nothing.
      // Don't speak it again, and don't let it into history to compound.
      log.info('ambient', 'Ambient check-in: model repeated its last reply, ignored')
      return
    }

    // Only the turns where something actually happened join the real
    // conversation history - otherwise every silent no-op tick (the common
    // case) would pile up as clutter the model has to read back every turn.
    history = trimHistory(newHistory)
    setWorkingHistory(history)
    lastDeliveredText = text
    appendTranscript({ role: 'assistant', text })
    log.info('ambient', `${settings.activeProvider} -> assistant (ambient): ${truncate(text)}`)
    win.webContents.send(IPC.chatMessage, text)
  } catch (err) {
    log.error('ambient', `${settings.activeProvider} ambient request failed`, err)
  } finally {
    win.webContents.send(IPC.chatThinking, false)
    agentBusy = false
  }
}
