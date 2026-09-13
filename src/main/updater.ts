import { shell, Notification } from 'electron'
import { autoUpdater } from 'electron-updater'
import { log } from './logger'

const RELEASES_OWNER = 'psiphon'
const RELEASES_REPO = 'verity-assistant'

function releaseUrl(version: string): string {
  return `https://github.com/${RELEASES_OWNER}/${RELEASES_REPO}/releases/tag/v${version}`
}

function notify(body: string, onClick?: () => void): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({ title: 'Verity', body })
  if (onClick) notification.on('click', onClick)
  notification.show()
}

// A manual "Check for updates now" click should always get some feedback
// (found / not found / error) - an automatic background check should stay
// silent unless it actually finds something, matching how ambient check-ins
// default to silence elsewhere in this app. This flag is how the shared
// update-not-available/error handlers know which case they're in.
let pendingManualCheck = false

let initialized = false

function ensureInitialized(): void {
  if (initialized) return
  initialized = true

  // Check + notify + link to the release, not a fully automatic silent
  // download-and-install. Auto-install adds real failure surface (code
  // signing, differential updates, a broken updater bricking the app) for a
  // hobby-scale desktop app - this satisfies "get nudged to upgrade" with
  // far less risk. The user opens the release page themselves and installs
  // it the same way they installed Verity in the first place. Deferred to
  // this lazy init (never touched merely by importing this module) since
  // accessing the `autoUpdater` singleton at all constructs a real updater
  // instance that pokes at Electron internals - harmless in the running
  // app, but not something a test importing this module should trigger.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('update-available', (info) => {
    log.info('updater', `Update available: ${info.version}`)
    notify(`Version ${info.version} is available - click to view the release.`, () =>
      shell.openExternal(releaseUrl(info.version))
    )
  })

  autoUpdater.on('update-not-available', () => {
    log.info('updater', 'No update available')
    if (pendingManualCheck) notify("You're on the latest version.")
    pendingManualCheck = false
  })

  autoUpdater.on('error', (err) => {
    log.warn('updater', 'Update check failed', err)
    if (pendingManualCheck) notify('Could not check for updates right now.')
    pendingManualCheck = false
  })
}

export async function checkForUpdates(manual = false): Promise<void> {
  ensureInitialized()
  if (manual) pendingManualCheck = true
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    log.warn('updater', 'Update check failed to start', err)
    if (manual) {
      notify('Could not check for updates right now.')
      pendingManualCheck = false
    }
  }
}
