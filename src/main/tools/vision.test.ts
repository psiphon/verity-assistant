import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron')

// Same custom-symbol trick as desktop.test.ts - promisify(execFile) resolves
// through this mock rather than a real child process.
const { execFileCustom } = vi.hoisted(() => ({ execFileCustom: vi.fn() }))
vi.mock('node:child_process', () => {
  const execFile = vi.fn() as unknown as { [key: symbol]: unknown }
  execFile[Symbol.for('nodejs.util.promisify.custom')] = execFileCustom
  return { execFile, default: { execFile } }
})

import { BrowserWindow, desktopCapturer } from 'electron'
import { captureScreen } from './vision'

const originalPlatform = process.platform

function setPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

function fakeSource(
  id: string,
  name: string,
  opts: { empty?: boolean; bytes?: number[] } = {}
): { id: string; name: string; thumbnail: { isEmpty(): boolean; toJPEG(q: number): Buffer } } {
  return {
    id,
    name,
    thumbnail: {
      isEmpty: () => opts.empty ?? false,
      toJPEG: () => Buffer.from(opts.bytes ?? [1, 2, 3])
    }
  }
}

const BrowserWindowMock = BrowserWindow as unknown as {
  instances: InstanceType<typeof BrowserWindow>[]
}

beforeEach(() => {
  BrowserWindowMock.instances.length = 0
  vi.mocked(desktopCapturer.getSources).mockResolvedValue([])
  execFileCustom.mockReset()
})

afterEach(() => {
  setPlatform(originalPlatform)
  vi.clearAllMocks()
})

describe('captureScreen on Windows', () => {
  beforeEach(() => setPlatform('win32'))

  it('captures the foreground window when its title differs from Verity’s own', async () => {
    const win = new BrowserWindow()
    vi.mocked(win.getTitle).mockReturnValue('Verity')
    execFileCustom.mockResolvedValue({ stdout: 'Notepad\r\n' })
    vi.mocked(desktopCapturer.getSources).mockResolvedValue([
      fakeSource('screen:0', 'Entire screen'),
      fakeSource('window:1', 'Notepad', { bytes: [9, 9, 9] })
    ] as never)

    const result = await captureScreen()

    expect(desktopCapturer.getSources).toHaveBeenCalledWith(
      expect.objectContaining({ types: ['window', 'screen'] })
    )
    expect(result).toEqual({
      mediaType: 'image/jpeg',
      base64: Buffer.from([9, 9, 9]).toString('base64')
    })
  })

  it('falls back to the screen when the foreground window is Verity itself', async () => {
    const win = new BrowserWindow()
    vi.mocked(win.getTitle).mockReturnValue('Verity')
    execFileCustom.mockResolvedValue({ stdout: 'Verity\r\n' })
    vi.mocked(desktopCapturer.getSources).mockResolvedValue([
      fakeSource('screen:0', 'Entire screen', { bytes: [5, 5, 5] })
    ] as never)

    const result = await captureScreen()

    expect(desktopCapturer.getSources).toHaveBeenCalledWith(
      expect.objectContaining({ types: ['screen'] })
    )
    expect(result).toEqual({
      mediaType: 'image/jpeg',
      base64: Buffer.from([5, 5, 5]).toString('base64')
    })
  })

  it('falls back to the screen when no window title can be determined', async () => {
    execFileCustom.mockResolvedValue({ stdout: '\r\n' })
    vi.mocked(desktopCapturer.getSources).mockResolvedValue([
      fakeSource('screen:0', 'Entire screen', { bytes: [7] })
    ] as never)

    const result = await captureScreen()
    expect(result).toEqual({ mediaType: 'image/jpeg', base64: Buffer.from([7]).toString('base64') })
  })

  it('reports failure when no usable source is found', async () => {
    execFileCustom.mockResolvedValue({ stdout: '\r\n' })
    vi.mocked(desktopCapturer.getSources).mockResolvedValue([])

    expect(await captureScreen()).toBe('Could not capture the screen.')
  })

  it('reports failure when the matched source has an empty thumbnail', async () => {
    execFileCustom.mockResolvedValue({ stdout: '\r\n' })
    vi.mocked(desktopCapturer.getSources).mockResolvedValue([
      fakeSource('screen:0', 'Entire screen', { empty: true })
    ] as never)

    expect(await captureScreen()).toBe('Could not capture the screen.')
  })

  it('falls back to the screen if the foreground-title lookup itself fails', async () => {
    execFileCustom.mockRejectedValue(new Error('powershell exploded'))
    vi.mocked(desktopCapturer.getSources).mockResolvedValue([
      fakeSource('screen:0', 'Entire screen', { bytes: [2] })
    ] as never)

    const result = await captureScreen()
    expect(result).toEqual({ mediaType: 'image/jpeg', base64: Buffer.from([2]).toString('base64') })
  })

  it('reports failure when desktopCapturer itself throws', async () => {
    execFileCustom.mockResolvedValue({ stdout: '\r\n' })
    vi.mocked(desktopCapturer.getSources).mockRejectedValue(new Error('boom'))

    expect(await captureScreen()).toBe('Could not capture the screen.')
  })
})

describe('captureScreen on non-Windows platforms', () => {
  beforeEach(() => setPlatform('darwin'))

  it('never shells out for a foreground title and captures the screen directly', async () => {
    vi.mocked(desktopCapturer.getSources).mockResolvedValue([
      fakeSource('screen:0', 'Entire screen', { bytes: [3] })
    ] as never)

    const result = await captureScreen()

    expect(execFileCustom).not.toHaveBeenCalled()
    expect(desktopCapturer.getSources).toHaveBeenCalledWith(
      expect.objectContaining({ types: ['screen'] })
    )
    expect(result).toEqual({ mediaType: 'image/jpeg', base64: Buffer.from([3]).toString('base64') })
  })
})
