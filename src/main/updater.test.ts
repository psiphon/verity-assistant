import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron')

const { autoUpdater } = vi.hoisted(() => ({
  autoUpdater: {
    autoDownload: undefined as boolean | undefined,
    autoInstallOnAppQuit: undefined as boolean | undefined,
    on: vi.fn(),
    checkForUpdates: vi.fn()
  }
}))
vi.mock('electron-updater', () => ({ autoUpdater }))

type NotificationCtor = (typeof import('electron'))['Notification']
type ShellModule = (typeof import('electron'))['shell']

function handlerFor(event: string): (...args: unknown[]) => void {
  const call = autoUpdater.on.mock.calls.find(([e]) => e === event)
  if (!call) throw new Error(`No handler registered for ${event}`)
  return call[1] as (...args: unknown[]) => void
}

// updater.ts keeps its "have I registered listeners yet" state as a
// module-level flag, exactly like a real singleton - so each test needs a
// fresh copy (via resetModules + a dynamic re-import) to see first-time
// registration happen and to isolate pendingManualCheck between scenarios.
// 'electron' itself gets re-imported alongside it in the same reset cycle,
// since resetModules would otherwise leave a top-level `import {
// Notification } from 'electron'` pointing at a stale pre-reset instance
// while updater.ts's fresh copy resolves to a different one.
let checkForUpdates: (typeof import('./updater'))['checkForUpdates']
let Notification: NotificationCtor
let shell: ShellModule
let notificationInstances: {
  opts: { title?: string; body?: string }
  on: ReturnType<typeof vi.fn>
}[]

beforeEach(async () => {
  vi.resetModules()
  autoUpdater.on.mockClear()
  autoUpdater.checkForUpdates.mockReset().mockResolvedValue(null)
  ;({ Notification, shell } = await import('electron'))
  vi.mocked(Notification.isSupported).mockReturnValue(true)
  vi.mocked(shell.openExternal).mockClear()
  notificationInstances = (Notification as unknown as { instances: typeof notificationInstances })
    .instances
  notificationInstances.length = 0
  ;({ checkForUpdates } = await import('./updater'))
})

describe('checkForUpdates', () => {
  it('configures autoDownload off and calls checkForUpdates', async () => {
    await checkForUpdates()
    expect(autoUpdater.autoDownload).toBe(false)
    expect(autoUpdater.autoInstallOnAppQuit).toBe(false)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalled()
  })

  it('does not re-register listeners on repeated calls', async () => {
    await checkForUpdates()
    const countAfterFirst = autoUpdater.on.mock.calls.length
    await checkForUpdates()
    expect(autoUpdater.on.mock.calls.length).toBe(countAfterFirst)
  })

  it('notifies and links to the release page when an update is found', async () => {
    await checkForUpdates()
    handlerFor('update-available')({ version: '1.2.3' })

    const notification = notificationInstances.at(-1)
    expect(notification?.opts.body).toContain('1.2.3')
    const clickHandler = notification!.on.mock.calls.find(([e]) => e === 'click')![1]
    clickHandler()
    expect(shell.openExternal).toHaveBeenCalledWith(
      'https://github.com/psiphon/verity-assistant/releases/tag/v1.2.3'
    )
  })

  it('stays silent on an automatic check that finds nothing', async () => {
    await checkForUpdates()
    handlerFor('update-not-available')({})
    expect(notificationInstances).toHaveLength(0)
  })

  it('notifies "up to date" on a manual check that finds nothing', async () => {
    await checkForUpdates(true)
    handlerFor('update-not-available')({})
    expect(notificationInstances.at(-1)?.opts.body).toMatch(/latest version/)
  })

  it('stays silent on an automatic check that errors', async () => {
    await checkForUpdates()
    handlerFor('error')(new Error('network down'))
    expect(notificationInstances).toHaveLength(0)
  })

  it('notifies on a manual check that errors via the error event', async () => {
    await checkForUpdates(true)
    handlerFor('error')(new Error('network down'))
    expect(notificationInstances.at(-1)?.opts.body).toMatch(/Could not check/)
  })

  it('notifies on a manual check where checkForUpdates itself rejects', async () => {
    autoUpdater.checkForUpdates.mockRejectedValueOnce(new Error('no feed configured'))
    await checkForUpdates(true)
    expect(notificationInstances.at(-1)?.opts.body).toMatch(/Could not check/)
  })
})
