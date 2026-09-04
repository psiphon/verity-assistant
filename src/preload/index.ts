import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC } from '@shared/ipc'
import type { AppSettings, McpServerStatus, RapportState, MemoryEntry } from '@shared/types'

const api = {
  chat: {
    send: (text: string): Promise<void> => ipcRenderer.invoke(IPC.chatSend, text),
    onThinking: (cb: (thinking: boolean) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, thinking: boolean): void => cb(thinking)
      ipcRenderer.on(IPC.chatThinking, listener)
      return () => ipcRenderer.removeListener(IPC.chatThinking, listener)
    },
    onMessage: (cb: (text: string) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, text: string): void => cb(text)
      ipcRenderer.on(IPC.chatMessage, listener)
      return () => ipcRenderer.removeListener(IPC.chatMessage, listener)
    },
    onError: (cb: (message: string) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, message: string): void => cb(message)
      ipcRenderer.on(IPC.chatError, listener)
      return () => ipcRenderer.removeListener(IPC.chatError, listener)
    },
    onToolCall: (
      cb: (call: { name: string; input: Record<string, unknown> }) => void
    ): (() => void) => {
      const listener = (
        _e: Electron.IpcRendererEvent,
        call: { name: string; input: Record<string, unknown> }
      ): void => cb(call)
      ipcRenderer.on(IPC.chatToolCall, listener)
      return () => ipcRenderer.removeListener(IPC.chatToolCall, listener)
    },
    onPlaySound: (cb: (name: string) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, name: string): void => cb(name)
      ipcRenderer.on(IPC.chatPlaySound, listener)
      return () => ipcRenderer.removeListener(IPC.chatPlaySound, listener)
    }
  },
  rapport: {
    get: (): Promise<RapportState> => ipcRenderer.invoke(IPC.rapportGet),
    reset: (): Promise<RapportState> => ipcRenderer.invoke(IPC.rapportReset),
    onChanged: (cb: (state: RapportState) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, state: RapportState): void => cb(state)
      ipcRenderer.on(IPC.rapportChanged, listener)
      return () => ipcRenderer.removeListener(IPC.rapportChanged, listener)
    }
  },
  memories: {
    get: (): Promise<MemoryEntry[]> => ipcRenderer.invoke(IPC.memoriesGet),
    delete: (id: string): Promise<MemoryEntry[]> => ipcRenderer.invoke(IPC.memoriesDelete, id),
    clear: (): Promise<MemoryEntry[]> => ipcRenderer.invoke(IPC.memoriesClear)
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsGet),
    set: (settings: AppSettings): Promise<void> => ipcRenderer.invoke(IPC.settingsSet, settings)
  },
  mcp: {
    getStatuses: (): Promise<McpServerStatus[]> => ipcRenderer.invoke(IPC.mcpStatuses),
    reload: (): Promise<McpServerStatus[]> => ipcRenderer.invoke(IPC.mcpReload),
    onStatuses: (cb: (statuses: McpServerStatus[]) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, statuses: McpServerStatus[]): void =>
        cb(statuses)
      ipcRenderer.on(IPC.mcpStatuses, listener)
      return () => ipcRenderer.removeListener(IPC.mcpStatuses, listener)
    }
  },
  window: {
    toggleAlwaysOnTop: (): Promise<boolean> => ipcRenderer.invoke(IPC.windowToggleAlwaysOnTop),
    onOpenSettings: (cb: () => void): (() => void) => {
      const listener = (): void => cb()
      ipcRenderer.on(IPC.windowOpenSettings, listener)
      return () => ipcRenderer.removeListener(IPC.windowOpenSettings, listener)
    },
    getPosition: (): [number, number] => ipcRenderer.sendSync(IPC.windowGetPosition),
    setPosition: (x: number, y: number): void => ipcRenderer.send(IPC.windowSetPosition, x, y)
  },
  logs: {
    getPath: (): Promise<string> => ipcRenderer.invoke(IPC.logsGetPath),
    openFolder: (): Promise<void> => ipcRenderer.invoke(IPC.logsOpenFolder),
    reportError: (message: string): void => ipcRenderer.send(IPC.logsRendererError, message)
  }
}

export type VerityApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('verity', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.verity = api
}
