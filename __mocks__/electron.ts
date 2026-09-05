import { vi } from 'vitest'
import { join } from 'node:path'
import os from 'node:os'

export const app = {
  getPath: vi.fn((name: string) => join(os.tmpdir(), 'verity-test-userdata', name)),
  getVersion: vi.fn(() => '0.0.0-test'),
  getName: vi.fn(() => 'verity-assistant'),
  whenReady: vi.fn(() => Promise.resolve()),
  on: vi.fn(),
  quit: vi.fn(),
  commandLine: { appendSwitch: vi.fn() }
}

class MockWebContents {
  send = vi.fn()
}

export class BrowserWindow {
  static instances: BrowserWindow[] = []
  static getAllWindows = vi.fn(() => BrowserWindow.instances)
  static fromWebContents = vi.fn(() => BrowserWindow.instances[0] ?? null)

  webContents = new MockWebContents()
  private opacity = 1
  private bounds = { x: 0, y: 0, width: 320, height: 420 }
  private alwaysOnTop = false

  constructor() {
    BrowserWindow.instances.push(this)
  }

  show = vi.fn()
  hide = vi.fn()
  focus = vi.fn()
  isVisible = vi.fn(() => true)
  isAlwaysOnTop = vi.fn(() => this.alwaysOnTop)
  setAlwaysOnTop = vi.fn((v: boolean) => {
    this.alwaysOnTop = v
  })
  loadURL = vi.fn()
  loadFile = vi.fn()
  on = vi.fn()
  flashFrame = vi.fn()
  getOpacity = vi.fn(() => this.opacity)
  setOpacity = vi.fn((v: number) => {
    this.opacity = v
  })
  getPosition = vi.fn(() => [this.bounds.x, this.bounds.y])
  getSize = vi.fn(() => [this.bounds.width, this.bounds.height])
  setBounds = vi.fn((b: Partial<typeof this.bounds>) => Object.assign(this.bounds, b))
  setSize = vi.fn((w: number, h: number) => {
    this.bounds.width = w
    this.bounds.height = h
  })
  setWindowOpenHandler = vi.fn()
}

export const ipcMain = {
  handle: vi.fn(),
  on: vi.fn()
}

export const ipcRenderer = {
  invoke: vi.fn(),
  send: vi.fn(),
  sendSync: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn()
}

export const contextBridge = {
  exposeInMainWorld: vi.fn()
}

export const shell = {
  openExternal: vi.fn(() => Promise.resolve()),
  openPath: vi.fn(() => Promise.resolve('')),
  showItemInFolder: vi.fn()
}

export const clipboard = {
  readText: vi.fn(() => '')
}

export const powerMonitor = {
  getSystemIdleTime: vi.fn(() => 0)
}

export class Notification {
  static isSupported = vi.fn(() => true)
  static instances: Notification[] = []
  show = vi.fn()
  constructor(public opts: { title?: string; body?: string }) {
    Notification.instances.push(this)
  }
}

export class Tray {
  setToolTip = vi.fn()
  setContextMenu = vi.fn()
  on = vi.fn()
}

export const Menu = {
  buildFromTemplate: vi.fn((items: unknown) => items)
}

export const nativeImage = {
  createFromPath: vi.fn(() => ({ resize: vi.fn(() => ({})) }))
}
