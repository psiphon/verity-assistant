import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron')

// child_process.execFile is turned into a promise via util.promisify, which
// (for execFile specifically) resolves through a well-known custom symbol
// rather than the plain callback - stubbing that symbol directly is what
// makes `promisify(execFile)` inside desktop.ts resolve to *this* mock.
// vi.mock factories are hoisted above imports, so the shared spy has to be
// created via vi.hoisted rather than a plain top-level const.
const { execFileCustom } = vi.hoisted(() => ({ execFileCustom: vi.fn() }))
vi.mock('node:child_process', () => {
  const execFile = vi.fn() as unknown as { [key: symbol]: unknown }
  execFile[Symbol.for('nodejs.util.promisify.custom')] = execFileCustom
  return { execFile, default: { execFile } }
})

import { Notification } from 'electron'
import { callDesktopTool, desktopToolDefinitions, type DesktopToolContext } from './desktop'

// The real electron.d.ts (used for type-checking) has no static `instances`
// - that only exists on the test double in __mocks__/electron.ts - so this
// narrow cast is how the mock's extra tracking gets accessed with types.
const NotificationMock = Notification as unknown as {
  isSupported: ReturnType<typeof vi.fn>
  instances: { opts: { title?: string; body?: string } }[]
}

function fakeCtx(): DesktopToolContext {
  return { flashWindow: vi.fn(), flickerWindow: vi.fn() }
}

const originalPlatform = process.platform

function setPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

afterEach(() => {
  setPlatform(originalPlatform)
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  NotificationMock.instances.length = 0
})

describe('desktopToolDefinitions', () => {
  it('declares the expected set of tools', () => {
    const names = desktopToolDefinitions().map((t) => t.name)
    expect(names).toEqual([
      'get_battery_status',
      'get_active_window_title',
      'list_running_apps',
      'set_system_volume',
      'cursor_nudge',
      'flash_window',
      'flicker_window',
      'set_reminder',
      'get_weather'
    ])
  })
})

describe('on a non-Windows platform', () => {
  beforeEach(() => setPlatform('linux'))

  it.each([
    'get_battery_status',
    'get_active_window_title',
    'list_running_apps',
    'set_system_volume',
    'cursor_nudge'
  ])('%s reports it is Windows-only without shelling out', async (name) => {
    const result = await callDesktopTool(name, { action: 'up', dx: 1, dy: 1 }, fakeCtx())
    expect(result).toMatch(/only implemented on Windows/)
    expect(execFileCustom).not.toHaveBeenCalled()
  })
})

describe('on Windows', () => {
  beforeEach(() => setPlatform('win32'))

  it('get_battery_status parses percentage and state from PowerShell JSON', async () => {
    execFileCustom.mockResolvedValue({
      stdout: '{"EstimatedChargeRemaining":73,"BatteryStatus":1}\r\n'
    })
    const result = await callDesktopTool('get_battery_status', {}, fakeCtx())
    expect(result).toBe('73% battery, discharging.')
  })

  it('get_battery_status reports no battery when PowerShell prints nothing', async () => {
    execFileCustom.mockResolvedValue({ stdout: '' })
    const result = await callDesktopTool('get_battery_status', {}, fakeCtx())
    expect(result).toBe('No battery detected - likely a desktop.')
  })

  it('get_battery_status falls back gracefully if PowerShell fails', async () => {
    execFileCustom.mockRejectedValue(new Error('boom'))
    const result = await callDesktopTool('get_battery_status', {}, fakeCtx())
    expect(result).toBe('No battery detected - likely a desktop.')
  })

  it('get_active_window_title returns the foreground window title', async () => {
    execFileCustom.mockResolvedValue({ stdout: '4242|Notepad\r\n' })
    const result = await callDesktopTool('get_active_window_title', {}, fakeCtx())
    expect(result).toBe('Notepad')
  })

  it('get_active_window_title recognizes when Verity itself is focused', async () => {
    execFileCustom.mockResolvedValue({ stdout: `${process.pid}|Verity\r\n` })
    const result = await callDesktopTool('get_active_window_title', {}, fakeCtx())
    expect(result).toBe("(you're currently focused on Verity itself)")
  })

  it('list_running_apps returns the formatted process list', async () => {
    execFileCustom.mockResolvedValue({ stdout: 'chrome: Inbox - Gmail\r\nnotepad: untitled\r\n' })
    const result = await callDesktopTool('list_running_apps', {}, fakeCtx())
    expect(result).toBe('chrome: Inbox - Gmail\r\nnotepad: untitled')
  })

  it('list_running_apps reports none found', async () => {
    execFileCustom.mockResolvedValue({ stdout: '' })
    const result = await callDesktopTool('list_running_apps', {}, fakeCtx())
    expect(result).toBe('(no other windowed apps found)')
  })

  describe('set_system_volume', () => {
    it('rejects an unknown action', async () => {
      const result = await callDesktopTool('set_system_volume', { action: 'sideways' }, fakeCtx())
      expect(result).toContain('action must be')
      expect(execFileCustom).not.toHaveBeenCalled()
    })

    it('nudges volume up and reports the step count', async () => {
      execFileCustom.mockResolvedValue({ stdout: '' })
      const result = await callDesktopTool(
        'set_system_volume',
        { action: 'up', steps: 3 },
        fakeCtx()
      )
      expect(result).toBe('Nudged volume up (3x).')
    })

    it('toggles mute regardless of steps', async () => {
      execFileCustom.mockResolvedValue({ stdout: '' })
      const result = await callDesktopTool(
        'set_system_volume',
        { action: 'mute', steps: 5 },
        fakeCtx()
      )
      expect(result).toBe('Toggled mute.')
    })

    it('reports failure if PowerShell errors', async () => {
      execFileCustom.mockRejectedValue(new Error('boom'))
      const result = await callDesktopTool('set_system_volume', { action: 'up' }, fakeCtx())
      expect(result).toBe('Could not change the volume.')
    })
  })

  describe('cursor_nudge', () => {
    it('clamps large offsets to +/-40', async () => {
      execFileCustom.mockResolvedValue({ stdout: '' })
      const result = await callDesktopTool('cursor_nudge', { dx: 999, dy: -999 }, fakeCtx())
      expect(result).toBe('Nudged the cursor by (40, -40).')
    })

    it('treats a non-numeric offset as zero', async () => {
      execFileCustom.mockResolvedValue({ stdout: '' })
      const result = await callDesktopTool('cursor_nudge', { dx: 'a lot', dy: 5 }, fakeCtx())
      expect(result).toBe('Nudged the cursor by (0, 5).')
    })

    it('reports failure if PowerShell errors', async () => {
      execFileCustom.mockRejectedValue(new Error('boom'))
      const result = await callDesktopTool('cursor_nudge', { dx: 1, dy: 1 }, fakeCtx())
      expect(result).toBe('Could not move the cursor.')
    })
  })
})

describe('flash_window / flicker_window', () => {
  it('flash_window calls the context and confirms it', async () => {
    const ctx = fakeCtx()
    const result = await callDesktopTool('flash_window', {}, ctx)
    expect(ctx.flashWindow).toHaveBeenCalled()
    expect(result).toBe('Flashed the window.')
  })

  it('flicker_window calls the context and confirms it', async () => {
    const ctx = fakeCtx()
    const result = await callDesktopTool('flicker_window', {}, ctx)
    expect(ctx.flickerWindow).toHaveBeenCalled()
    expect(result).toBe('Flickered the window.')
  })
})

describe('set_reminder', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('confirms the reminder immediately and fires a notification later', async () => {
    vi.mocked(Notification.isSupported).mockReturnValue(true)
    const result = await callDesktopTool(
      'set_reminder',
      { minutes: 5, message: 'stretch' },
      fakeCtx()
    )
    expect(result).toBe('Okay, I\'ll remind you in 5 minute(s): "stretch"')

    vi.advanceTimersByTime(5 * 60_000)
    expect(NotificationMock.instances.at(-1)?.opts).toEqual({ title: 'Verity', body: 'stretch' })
  })

  it('clamps minutes into the 0.1-180 range', async () => {
    const result = await callDesktopTool(
      'set_reminder',
      { minutes: 99999, message: 'x' },
      fakeCtx()
    )
    expect(result).toContain('in 180 minute(s)')
  })

  it('falls back to a generic message when none is given', async () => {
    const result = await callDesktopTool('set_reminder', { minutes: 1, message: '  ' }, fakeCtx())
    expect(result).toContain('"Reminder!"')
  })
})

describe('get_weather', () => {
  it('geocodes a given location then reports the forecast', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          results: [{ latitude: 1, longitude: 2, name: 'Testville', country: 'TC' }]
        })
      })
      .mockResolvedValueOnce({
        json: async () => ({
          current: { temperature_2m: 71.2, weather_code: 0, wind_speed_10m: 5.4 }
        })
      })
    vi.stubGlobal('fetch', fetchMock)

    const result = await callDesktopTool('get_weather', { location: 'Testville' }, fakeCtx())
    expect(result).toBe('Testville, TC: 71°F, clear sky, wind 5mph.')
    expect(fetchMock.mock.calls[0][0]).toContain('geocoding-api.open-meteo.com')
  })

  it('falls back to IP geolocation when no location is given', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({ latitude: 10, longitude: 20, city: 'Somewhere', country_name: 'Land' })
      })
      .mockResolvedValueOnce({
        json: async () => ({
          current: { temperature_2m: 50, weather_code: 61, wind_speed_10m: 10 }
        })
      })
    vi.stubGlobal('fetch', fetchMock)

    const result = await callDesktopTool('get_weather', {}, fakeCtx())
    expect(result).toBe('Somewhere, Land: 50°F, light rain, wind 10mph.')
    expect(fetchMock.mock.calls[0][0]).toContain('ipapi.co')
  })

  it('reports when no location could be resolved', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ results: [] }) }))
    const result = await callDesktopTool('get_weather', { location: 'Nowhereville' }, fakeCtx())
    expect(result).toBe("Couldn't figure out a location for the weather.")
  })

  it('handles a network failure gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const result = await callDesktopTool('get_weather', { location: 'Testville' }, fakeCtx())
    expect(result).toBe('Could not fetch the weather right now.')
  })
})

describe('callDesktopTool', () => {
  it('returns undefined for an unrelated tool name', async () => {
    const result = await callDesktopTool('get_current_time', {}, fakeCtx())
    expect(result).toBeUndefined()
  })
})
