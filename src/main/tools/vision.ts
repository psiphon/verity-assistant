import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { desktopCapturer, BrowserWindow } from 'electron'
import type { ToolDefinition } from '../llm/types'
import { log } from '../logger'

const execFileAsync = promisify(execFile)
const PS_TIMEOUT_MS = 5000
// A hard ceiling, not a suggestion - same philosophy as MAX_READ_BYTES in
// filesystem.ts. Vision tokens are expensive and a full-res screenshot is
// overkill for "what does this look like."
const MAX_THUMBNAIL_DIMENSION = 1280
const JPEG_QUALITY = 70

export interface CapturedImage {
  mediaType: string
  base64: string
}

export function visionToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'look_at_screen',
      description:
        "Take a screenshot of whatever window the user currently has focused (or the whole screen if that can't be determined) so you can actually see what they're looking at, not just guess from a window title. Only call this when the user has actually asked you to look at their screen - never on your own, and never during an ambient check-in.",
      inputSchema: { type: 'object', properties: {} }
    }
  ]
}

// Windows-only, matching desktop.ts's own foreground-window detection - used
// here only to pick which desktopCapturer source to prefer, not exposed as
// its own tool.
async function foregroundWindowTitle(): Promise<string | null> {
  if (process.platform !== 'win32') return null
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; using System.Text; public class VerityVisionWin32 { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count); }'
$h = [VerityVisionWin32]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 256
[VerityVisionWin32]::GetWindowText($h, $sb, 256) | Out-Null
$sb.ToString()`
      ],
      { timeout: PS_TIMEOUT_MS }
    )
    const title = stdout.trim()
    return title || null
  } catch (err) {
    log.warn('vision', 'foregroundWindowTitle failed', err)
    return null
  }
}

/** Captures a downscaled JPEG of the user's focused window, or the primary
 * screen when that can't be determined (non-Windows, no real foreground
 * title, or the foreground window turns out to be Verity's own - asking to
 * "see" a 320x420 transparent widget isn't what anyone means). Returns a
 * plain string instead of throwing on any failure, since this is surfaced
 * directly as a tool result. */
export async function captureScreen(): Promise<CapturedImage | string> {
  try {
    const ownTitle = BrowserWindow.getAllWindows()[0]?.getTitle()
    const foreground = await foregroundWindowTitle()
    const targetTitle = foreground && foreground !== ownTitle ? foreground : null

    const sources = await desktopCapturer.getSources({
      types: targetTitle ? ['window', 'screen'] : ['screen'],
      thumbnailSize: { width: MAX_THUMBNAIL_DIMENSION, height: MAX_THUMBNAIL_DIMENSION }
    })
    const source =
      (targetTitle && sources.find((s) => s.name === targetTitle)) ??
      sources.find((s) => s.id.startsWith('screen'))

    if (!source || source.thumbnail.isEmpty()) {
      return 'Could not capture the screen.'
    }
    const jpeg = source.thumbnail.toJPEG(JPEG_QUALITY)
    return { mediaType: 'image/jpeg', base64: jpeg.toString('base64') }
  } catch (err) {
    log.warn('vision', 'look_at_screen failed', err)
    return 'Could not capture the screen.'
  }
}
