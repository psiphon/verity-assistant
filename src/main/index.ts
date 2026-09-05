import { app, shell, BrowserWindow, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpcHandlers, initAgentBackend, startAmbientTimer } from './ipc'
import { settingsStore } from './store'
import { initLogger, log } from './logger'
import { IPC } from '@shared/ipc'
import { WINDOW_SIZE } from './windowConfig'

// Chromium normally requires a real user gesture before an AudioContext will
// produce audible output, to stop web pages from autoplaying ads. That's the
// wrong default here: ambient check-ins (see ipc.ts) trigger sound effects
// with nobody having clicked anything, and this app only ever loads its own
// first-party UI - there's no untrusted content to protect the user from.
// Without this, those sounds fire (tool call, IPC, everything) but are
// silently inaudible until the user happens to click/type something first.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

let tray: Tray | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...WINDOW_SIZE,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    // Fixed-size widget, moved by dragging the face - resizing isn't a
    // feature we offer. resizable/maximizable/etc only block specific
    // *causes* of resize, and something was still getting through - pinning
    // min and max to the exact same value is a structural guarantee instead:
    // Chromium clamps every resize request (external or internal, whatever
    // triggers it) to [min, max], and here there's no room in that range to
    // change to.
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    minWidth: WINDOW_SIZE.width,
    minHeight: WINDOW_SIZE.height,
    maxWidth: WINDOW_SIZE.width,
    maxHeight: WINDOW_SIZE.height,
    alwaysOnTop: settingsStore.get('alwaysOnTop'),
    skipTaskbar: false,
    icon: process.platform === 'linux' ? icon : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // Belt-and-suspenders: if the window's size ever changes for any reason
  // (a Windows Snap gesture, a stray setBounds, anything), snap it straight
  // back. This widget's size is never supposed to change.
  win.on('resize', () => {
    const [w, h] = win.getSize()
    if (w !== WINDOW_SIZE.width || h !== WINDOW_SIZE.height) {
      win.setSize(WINDOW_SIZE.width, WINDOW_SIZE.height)
    }
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

function createTray(win: BrowserWindow): void {
  const trayIcon = nativeImage.createFromPath(icon).resize({ width: 16, height: 16 })
  tray = new Tray(trayIcon)
  tray.setToolTip('Verity')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Show / Hide',
        click: () => (win.isVisible() ? win.hide() : win.show())
      },
      {
        label: 'Settings',
        click: () => {
          win.show()
          win.focus()
          win.webContents.send(IPC.windowOpenSettings)
        }
      },
      {
        label: 'Always on Top',
        type: 'checkbox',
        checked: win.isAlwaysOnTop(),
        click: (item) => {
          win.setAlwaysOnTop(item.checked)
          settingsStore.set('alwaysOnTop', item.checked)
        }
      },
      { type: 'separator' },
      { label: 'Quit Verity', click: () => app.quit() }
    ])
  )
  tray.on('click', () => (win.isVisible() ? win.hide() : win.show()))
}

process.on('uncaughtException', (err) => log.error('main', 'Uncaught exception', err))
process.on('unhandledRejection', (err) => log.error('main', 'Unhandled rejection', err))

app.whenReady().then(async () => {
  initLogger()
  electronApp.setAppUserModelId('com.verity.assistant')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcHandlers()
  await initAgentBackend()
  startAmbientTimer()

  const win = createWindow()
  createTray(win)

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    log.info('app', 'All windows closed, quitting')
    app.quit()
  }
})
