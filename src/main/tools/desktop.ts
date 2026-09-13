import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import type { ToolDefinition } from '../llm/types'
import { log } from '../logger'
import { scheduleReminder, getReminders } from '../reminders'

const execFileAsync = promisify(execFile)
const SHELL_TIMEOUT_MS = 5000

async function runPowerShell(script: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { timeout: SHELL_TIMEOUT_MS }
  )
  return stdout.trim()
}

async function runOsascript(script: string): Promise<string> {
  const { stdout } = await execFileAsync('osascript', ['-e', script], {
    timeout: SHELL_TIMEOUT_MS
  })
  return stdout.trim()
}

// Best-effort Linux equivalents (xdotool/amixer/wmctrl) - unlike Windows and
// macOS, there's no single bundled tool that reliably works across distros
// and desktop environments (X11 vs Wayland, window manager differences), so
// these simply fail into the existing generic error message when the
// command isn't installed, rather than pretending to be fully supported.
async function runShell(command: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, args, { timeout: SHELL_TIMEOUT_MS })
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
      description: "Get the user's laptop battery percentage and charging state.",
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'get_active_window_title',
      description:
        "Get the title (or, on macOS, the app name) of whatever window the user currently has focused. Often just shows Verity itself while they're actively typing to you.",
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'list_running_apps',
      description:
        "List the user's currently open applications - useful for noticing what they're working on. Includes window titles on Windows; app names only on macOS/Linux.",
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'set_system_volume',
      description:
        "Nudge the user's system volume up/down a small amount, or toggle mute (not exact percentages).",
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
        'Schedule a native notification to pop up after a delay. Persists across restarts (if Verity is closed when it comes due, it fires as soon as it reopens, as long as that is within about an hour of the original time).',
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
      name: 'list_reminders',
      description: "List the user's pending reminders (soonest first).",
      inputSchema: { type: 'object', properties: {} }
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

const NO_BATTERY_MESSAGE = 'No battery detected - likely a desktop.'

async function getBatteryStatusWindows(): Promise<string> {
  const stdout = await runPowerShell(
    'Get-CimInstance -ClassName Win32_Battery | Select-Object -First 1 -Property EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json -Compress'
  )
  if (!stdout) return NO_BATTERY_MESSAGE
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
}

async function getBatteryStatusMac(): Promise<string> {
  const stdout = await runShell('pmset', ['-g', 'batt'])
  const match = stdout.match(/(\d+)%;\s*([a-zA-Z ]+);/)
  if (!match) return NO_BATTERY_MESSAGE
  return `${match[1]}% battery, ${match[2].trim()}.`
}

async function getBatteryStatusLinux(): Promise<string> {
  for (const battery of ['BAT0', 'BAT1']) {
    try {
      const base = `/sys/class/power_supply/${battery}`
      const [capacity, status] = await Promise.all([
        readFile(`${base}/capacity`, 'utf8'),
        readFile(`${base}/status`, 'utf8')
      ])
      return `${capacity.trim()}% battery, ${status.trim().toLowerCase()}.`
    } catch {
      // try the next battery id, or fall through to "no battery" below
    }
  }
  return NO_BATTERY_MESSAGE
}

async function getBatteryStatus(): Promise<string> {
  try {
    if (process.platform === 'win32') return await getBatteryStatusWindows()
    if (process.platform === 'darwin') return await getBatteryStatusMac()
    if (process.platform === 'linux') return await getBatteryStatusLinux()
    return NO_BATTERY_MESSAGE
  } catch (err) {
    log.warn('desktop', 'get_battery_status failed', err)
    return NO_BATTERY_MESSAGE
  }
}

const NO_WINDOW_TITLE_MESSAGE = '(no window title available)'
const VERITY_FOCUSED_MESSAGE = "(you're currently focused on Verity itself)"

async function getActiveWindowTitleWindows(): Promise<string> {
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
  if (sep === -1) return NO_WINDOW_TITLE_MESSAGE
  const pidStr = stdout.slice(0, sep)
  const title = stdout.slice(sep + 1).trim()
  if (Number(pidStr) === process.pid) return VERITY_FOCUSED_MESSAGE
  return title || NO_WINDOW_TITLE_MESSAGE
}

async function getActiveWindowTitleMac(): Promise<string> {
  const stdout = await runOsascript(
    'tell application "System Events" to get unix id of first process whose frontmost is true & "|" & (name of first process whose frontmost is true)'
  )
  const sep = stdout.indexOf('|')
  if (sep === -1) return NO_WINDOW_TITLE_MESSAGE
  const pidStr = stdout.slice(0, sep)
  const name = stdout.slice(sep + 1).trim()
  if (Number(pidStr) === process.pid) return VERITY_FOCUSED_MESSAGE
  return name || NO_WINDOW_TITLE_MESSAGE
}

async function getActiveWindowTitleLinux(): Promise<string> {
  const title = await runShell('xdotool', ['getactivewindow', 'getwindowname'])
  return title || NO_WINDOW_TITLE_MESSAGE
}

async function getActiveWindowTitle(): Promise<string> {
  try {
    if (process.platform === 'win32') return await getActiveWindowTitleWindows()
    if (process.platform === 'darwin') return await getActiveWindowTitleMac()
    if (process.platform === 'linux') return await getActiveWindowTitleLinux()
    return 'Active window detection is not supported on this platform.'
  } catch (err) {
    log.warn('desktop', 'get_active_window_title failed', err)
    return 'Could not determine the active window.'
  }
}

const NO_RUNNING_APPS_MESSAGE = '(no other windowed apps found)'

async function listRunningAppsWindows(): Promise<string> {
  const stdout = await runPowerShell(
    `Get-Process | Where-Object { $_.MainWindowTitle -ne '' -and $_.Id -ne ${process.pid} } | Select-Object -First 30 ProcessName, MainWindowTitle | ForEach-Object { "$($_.ProcessName): $($_.MainWindowTitle)" }`
  )
  return stdout || NO_RUNNING_APPS_MESSAGE
}

async function listRunningAppsMac(): Promise<string> {
  const stdout = await runOsascript(
    'tell application "System Events" to get name of every process whose background only is false'
  )
  const names = stdout
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
    .slice(0, 30)
  return names.length > 0 ? names.join('\n') : NO_RUNNING_APPS_MESSAGE
}

async function listRunningAppsLinux(): Promise<string> {
  const stdout = await runShell('wmctrl', ['-l'])
  const titles = stdout
    .split('\n')
    .map((line) => line.trim())
    // wmctrl -l columns: window-id desktop host title... - title is
    // everything from the 4th whitespace-separated field onward.
    .map((line) => line.split(/\s+/).slice(3).join(' '))
    .filter(Boolean)
    .slice(0, 30)
  return titles.length > 0 ? titles.join('\n') : NO_RUNNING_APPS_MESSAGE
}

async function listRunningApps(): Promise<string> {
  try {
    if (process.platform === 'win32') return await listRunningAppsWindows()
    if (process.platform === 'darwin') return await listRunningAppsMac()
    if (process.platform === 'linux') return await listRunningAppsLinux()
    return 'Listing running apps is not supported on this platform.'
  } catch (err) {
    log.warn('desktop', 'list_running_apps failed', err)
    return 'Could not list running apps.'
  }
}

type VolumeAction = 'up' | 'down' | 'mute'

async function setSystemVolumeWindows(action: VolumeAction, presses: number): Promise<void> {
  const vk = action === 'up' ? 0xaf : action === 'down' ? 0xae : 0xad
  await runPowerShell(`
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class VerityVolume { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo); }'
for ($i = 0; $i -lt ${presses}; $i++) {
  [VerityVolume]::keybd_event(${vk}, 0, 0, [System.UIntPtr]::Zero)
  [VerityVolume]::keybd_event(${vk}, 0, 2, [System.UIntPtr]::Zero)
}
`)
}

async function setSystemVolumeMac(action: VolumeAction, steps: number): Promise<void> {
  if (action === 'mute') {
    const isMuted = await runOsascript('output muted of (get volume settings)')
    await runOsascript(`set volume output muted ${isMuted === 'true' ? 'false' : 'true'}`)
    return
  }
  const current = Number(await runOsascript('output volume of (get volume settings)'))
  const delta = (action === 'up' ? 1 : -1) * steps * 10
  const next = Math.max(0, Math.min(100, (Number.isFinite(current) ? current : 50) + delta))
  await runOsascript(`set volume output volume ${next}`)
}

async function setSystemVolumeLinux(action: VolumeAction, steps: number): Promise<void> {
  if (action === 'mute') {
    await runShell('amixer', ['-q', 'set', 'Master', 'toggle'])
    return
  }
  await runShell('amixer', ['-q', 'set', 'Master', `${steps * 10}%${action === 'up' ? '+' : '-'}`])
}

async function setSystemVolume(action: unknown, stepsInput: unknown): Promise<string> {
  if (action !== 'up' && action !== 'down' && action !== 'mute') {
    return 'action must be "up", "down", or "mute"'
  }
  const steps = Math.max(1, Math.min(10, Number(stepsInput) || 2))
  const presses = action === 'mute' ? 1 : steps
  try {
    if (process.platform === 'win32') await setSystemVolumeWindows(action, presses)
    else if (process.platform === 'darwin') await setSystemVolumeMac(action, steps)
    else if (process.platform === 'linux') await setSystemVolumeLinux(action, steps)
    else return 'Volume control is not supported on this platform.'
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

function listReminders(): string {
  const reminders = getReminders()
  if (reminders.length === 0) return '(no pending reminders)'
  return reminders
    .map((r) => `- "${r.message}" at ${new Date(r.fireAt).toLocaleString()}`)
    .join('\n')
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
      return scheduleReminder(input.minutes, input.message)
    case 'list_reminders':
      return listReminders()
    case 'get_weather':
      return getWeather(input.location)
    default:
      return undefined
  }
}
