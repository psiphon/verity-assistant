import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Notification } from 'electron'
import type { ToolDefinition } from '../llm/types'
import { log } from '../logger'

const execFileAsync = promisify(execFile)
const PS_TIMEOUT_MS = 5000

async function runPowerShell(script: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { timeout: PS_TIMEOUT_MS }
  )
  return stdout.trim()
}

const WEATHER_CODES: Record<number, string> = {
  0: 'clear sky',
  1: 'mostly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'fog',
  48: 'freezing fog',
  51: 'light drizzle',
  53: 'drizzle',
  55: 'heavy drizzle',
  61: 'light rain',
  63: 'rain',
  65: 'heavy rain',
  71: 'light snow',
  73: 'snow',
  75: 'heavy snow',
  80: 'rain showers',
  81: 'heavy rain showers',
  82: 'violent rain showers',
  95: 'thunderstorm',
  96: 'thunderstorm with hail'
}

export function desktopToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'get_battery_status',
      description: "Get the user's laptop battery percentage and charging state (Windows only).",
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'get_active_window_title',
      description:
        "Get the title of whatever window the user currently has focused (Windows only). Often just shows Verity itself while they're actively typing to you.",
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'list_running_apps',
      description:
        "List the user's currently open applications (window titles, Windows only) - useful for noticing what they're working on.",
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'set_system_volume',
      description:
        "Nudge the user's system volume up/down a small amount, or toggle mute (Windows only, simulates the hardware volume keys - not exact percentages).",
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['up', 'down', 'mute'] },
          steps: { type: 'number', description: 'How many presses for up/down, default 2.' }
        },
        required: ['action']
      }
    },
    {
      name: 'cursor_nudge',
      description:
        "Nudge the user's mouse cursor a small distance (Windows only, capped to a subtle amount) - a harmless little 'something moved' moment, not real control.",
      inputSchema: {
        type: 'object',
        properties: {
          dx: { type: 'number', description: 'Horizontal offset in pixels, -40 to 40.' },
          dy: { type: 'number', description: 'Vertical offset in pixels, -40 to 40.' }
        },
        required: ['dx', 'dy']
      }
    },
    {
      name: 'flash_window',
      description:
        "Flash Verity's window/taskbar icon briefly to grab the user's attention - either for something that genuinely deserves it, or, sparingly, just to unsettle.",
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'flicker_window',
      description:
        "Briefly flicker Verity's own window opacity, like a bad connection. Purely visual, self-contained, never blocks anything - use sparingly for an unsettling beat.",
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'set_reminder',
      description:
        'Schedule a native notification to pop up after a delay. Only fires if Verity is still running - not a real persistent alarm.',
      inputSchema: {
        type: 'object',
        properties: {
          minutes: { type: 'number', description: 'Delay before the reminder fires, 0-180.' },
          message: { type: 'string', description: 'What the reminder should say.' }
        },
        required: ['minutes', 'message']
      }
    },
    {
      name: 'get_weather',
      description:
        "Get the current weather. Omit location to use the user's approximate IP-based location, or pass a city name.",
      inputSchema: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City name. Omit to guess from IP.' }
        }
      }
    }
  ]
}

async function getBatteryStatus(): Promise<string> {
  if (process.platform !== 'win32') return 'Battery status is only implemented on Windows.'
  try {
    const stdout = await runPowerShell(
      'Get-CimInstance -ClassName Win32_Battery | Select-Object -First 1 -Property EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json -Compress'
    )
    if (!stdout) return 'No battery detected - likely a desktop.'
    const data = JSON.parse(stdout) as { EstimatedChargeRemaining?: number; BatteryStatus?: number }
    const statusMap: Record<number, string> = {
      1: 'discharging',
      2: 'plugged in',
      3: 'fully charged',
      6: 'charging',
      7: 'charging',
      8: 'charging (low)',
      9: 'charging (critical)',
      11: 'partially charged'
    }
    const state =
      data.BatteryStatus !== undefined
        ? (statusMap[data.BatteryStatus] ?? 'unknown state')
        : 'unknown state'
    return data.EstimatedChargeRemaining !== undefined
      ? `${data.EstimatedChargeRemaining}% battery, ${state}.`
      : `Battery status: ${state}.`
  } catch (err) {
    log.warn('desktop', 'get_battery_status failed', err)
    return 'No battery detected - likely a desktop.'
  }
}

async function getActiveWindowTitle(): Promise<string> {
  if (process.platform !== 'win32') return 'Active window detection is only implemented on Windows.'
  try {
    const stdout = await runPowerShell(`
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; using System.Text; public class VerityWin32 { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId); }'
$h = [VerityWin32]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 256
[VerityWin32]::GetWindowText($h, $sb, 256) | Out-Null
$procId = 0
[VerityWin32]::GetWindowThreadProcessId($h, [ref]$procId) | Out-Null
"$procId|$($sb.ToString())"
`)
    const sep = stdout.indexOf('|')
    if (sep === -1) return '(no window title available)'
    const pidStr = stdout.slice(0, sep)
    const title = stdout.slice(sep + 1).trim()
    if (Number(pidStr) === process.pid) return "(you're currently focused on Verity itself)"
    return title || '(no window title available)'
  } catch (err) {
    log.warn('desktop', 'get_active_window_title failed', err)
    return 'Could not determine the active window.'
  }
}

async function listRunningApps(): Promise<string> {
  if (process.platform !== 'win32') return 'Listing running apps is only implemented on Windows.'
  try {
    const stdout = await runPowerShell(
      `Get-Process | Where-Object { $_.MainWindowTitle -ne '' -and $_.Id -ne ${process.pid} } | Select-Object -First 30 ProcessName, MainWindowTitle | ForEach-Object { "$($_.ProcessName): $($_.MainWindowTitle)" }`
    )
    return stdout || '(no other windowed apps found)'
  } catch (err) {
    log.warn('desktop', 'list_running_apps failed', err)
    return 'Could not list running apps.'
  }
}

async function setSystemVolume(action: unknown, stepsInput: unknown): Promise<string> {
  if (process.platform !== 'win32') return 'Volume control is only implemented on Windows.'
  const steps = Math.max(1, Math.min(10, Number(stepsInput) || 2))
  const vk = action === 'up' ? 0xaf : action === 'down' ? 0xae : action === 'mute' ? 0xad : null
  if (vk === null) return 'action must be "up", "down", or "mute"'
  const presses = action === 'mute' ? 1 : steps
  try {
    await runPowerShell(`
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class VerityVolume { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo); }'
for ($i = 0; $i -lt ${presses}; $i++) {
  [VerityVolume]::keybd_event(${vk}, 0, 0, [System.UIntPtr]::Zero)
  [VerityVolume]::keybd_event(${vk}, 0, 2, [System.UIntPtr]::Zero)
}
`)
    return action === 'mute' ? 'Toggled mute.' : `Nudged volume ${action} (${presses}x).`
  } catch (err) {
    log.warn('desktop', 'set_system_volume failed', err)
    return 'Could not change the volume.'
  }
}

async function cursorNudge(dxInput: unknown, dyInput: unknown): Promise<string> {
  if (process.platform !== 'win32') return 'Cursor control is only implemented on Windows.'
  const clamp = (n: unknown): number => {
    const num = Number(n)
    return Math.max(-40, Math.min(40, Math.round(Number.isFinite(num) ? num : 0)))
  }
  const dx = clamp(dxInput)
  const dy = clamp(dyInput)
  try {
    await runPowerShell(`
Add-Type -AssemblyName System.Windows.Forms
$p = [System.Windows.Forms.Cursor]::Position
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(($p.X + ${dx}), ($p.Y + ${dy}))
`)
    return `Nudged the cursor by (${dx}, ${dy}).`
  } catch (err) {
    log.warn('desktop', 'cursor_nudge failed', err)
    return 'Could not move the cursor.'
  }
}

function setReminder(minutesInput: unknown, messageInput: unknown): string {
  const minutes = Math.max(0.1, Math.min(180, Number(minutesInput) || 1))
  const message = String(messageInput ?? '').trim() || 'Reminder!'
  setTimeout(() => {
    if (Notification.isSupported()) new Notification({ title: 'Verity', body: message }).show()
  }, minutes * 60_000)
  return `Okay, I'll remind you in ${minutes} minute(s): "${message}"`
}

interface GeoResult {
  latitude: number
  longitude: number
  label: string
}

async function resolveLocation(location: string | undefined): Promise<GeoResult | null> {
  if (location?.trim()) {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(location.trim())}`
    )
    if (res.ok === false) return null
    const data = (await res.json()) as {
      results?: { latitude: number; longitude: number; name: string; country?: string }[]
    }
    const first = data.results?.[0]
    if (!first) return null
    return {
      latitude: first.latitude,
      longitude: first.longitude,
      label: [first.name, first.country].filter(Boolean).join(', ')
    }
  }
  // No location given - this discloses the user's public IP to ipapi.co for
  // approximate geolocation. Documented in Settings.
  const res = await fetch('https://ipapi.co/json/')
  if (res.ok === false) return null
  const data = (await res.json()) as {
    latitude?: number
    longitude?: number
    city?: string
    country_name?: string
  }
  if (data.latitude === undefined || data.longitude === undefined) return null
  return {
    latitude: data.latitude,
    longitude: data.longitude,
    label: [data.city, data.country_name].filter(Boolean).join(', ') || 'your area'
  }
}

async function getWeather(locationInput: unknown): Promise<string> {
  try {
    const geo = await resolveLocation(typeof locationInput === 'string' ? locationInput : undefined)
    if (!geo) return "Couldn't figure out a location for the weather."
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}&current=temperature_2m,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph`
    )
    if (res.ok === false) return `Couldn't get a forecast for ${geo.label}.`
    const data = (await res.json()) as {
      current?: { temperature_2m: number; weather_code: number; wind_speed_10m: number }
    }
    if (!data.current) return `Couldn't get a forecast for ${geo.label}.`
    const desc = WEATHER_CODES[data.current.weather_code] ?? 'unknown conditions'
    return `${geo.label}: ${Math.round(data.current.temperature_2m)}°F, ${desc}, wind ${Math.round(data.current.wind_speed_10m)}mph.`
  } catch (err) {
    log.warn('desktop', 'get_weather failed', err)
    return 'Could not fetch the weather right now.'
  }
}

export interface DesktopToolContext {
  flashWindow: () => void
  flickerWindow: () => void
}

export async function callDesktopTool(
  name: string,
  input: Record<string, unknown>,
  ctx: DesktopToolContext
): Promise<string | undefined> {
  switch (name) {
    case 'get_battery_status':
      return getBatteryStatus()
    case 'get_active_window_title':
      return getActiveWindowTitle()
    case 'list_running_apps':
      return listRunningApps()
    case 'set_system_volume':
      return setSystemVolume(input.action, input.steps)
    case 'cursor_nudge':
      return cursorNudge(input.dx, input.dy)
    case 'flash_window':
      ctx.flashWindow()
      return 'Flashed the window.'
    case 'flicker_window':
      ctx.flickerWindow()
      return 'Flickered the window.'
    case 'set_reminder':
      return setReminder(input.minutes, input.message)
    case 'get_weather':
      return getWeather(input.location)
    default:
      return undefined
  }
}
