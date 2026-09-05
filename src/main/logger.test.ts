import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron')

// logger.ts imports from the bare 'fs' specifier - mocking that exact
// specifier (not 'node:fs', which this test file uses below to read files
// back with the *real* fs) lets one test inject a write failure while every
// other test gets the real implementation via passthrough.
const { appendFileSyncMock } = vi.hoisted(() => ({ appendFileSyncMock: vi.fn() }))
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  appendFileSyncMock.mockImplementation(actual.appendFileSync)
  return { ...actual, appendFileSync: appendFileSyncMock }
})

import { app } from 'electron'
import { promises as fsp, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getLogPath, initLogger, log } from './logger'

let userDataDir: string

beforeEach(async () => {
  userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'verity-logger-test-'))
  vi.mocked(app.getPath).mockReturnValue(userDataDir)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fsp.rm(userDataDir, { recursive: true, force: true })
})

function readLines(logPath: string): Record<string, unknown>[] {
  return readFileSync(logPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
}

describe('logger', () => {
  it('creates the log directory and writes a startup line on init', () => {
    initLogger()
    const logPath = getLogPath()
    expect(logPath).toBe(path.join(userDataDir, 'logs', 'verity.log'))

    const lines = readLines(logPath)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ level: 'info', scope: 'app' })
    expect(lines[0].message).toContain('Verity starting')
  })

  it('appends subsequent log lines as JSON with a timestamp', () => {
    initLogger()
    log.info('chat', 'hello world', { extra: 1 })
    log.warn('chat', 'a warning')
    log.error('chat', 'an error', new Error('boom'))

    const lines = readLines(getLogPath())
    expect(lines).toHaveLength(4) // startup + 3
    expect(lines[1]).toMatchObject({
      level: 'info',
      scope: 'chat',
      message: 'hello world',
      data: { extra: 1 }
    })
    expect(lines[2]).toMatchObject({ level: 'warn', scope: 'chat', message: 'a warning' })
    expect(lines[3]).toMatchObject({ level: 'error', scope: 'chat', message: 'an error' })
    expect(typeof lines[0].t).toBe('string')
  })

  it('serializes an Error with name/message/stack plus any extra enumerable properties', () => {
    initLogger()
    const err = new Error('api failed') as Error & { status: number }
    err.status = 429
    log.error('llm', 'request failed', err)

    const lines = readLines(getLogPath())
    const data = lines[1].data as { name: string; message: string; stack: string; status: number }
    expect(data.name).toBe('Error')
    expect(data.message).toBe('api failed')
    expect(data.status).toBe(429)
    expect(typeof data.stack).toBe('string')
  })

  it('passes non-Error data through unchanged', () => {
    initLogger()
    log.info('mcp', 'statuses', { count: 3 })
    const lines = readLines(getLogPath())
    expect(lines[1].data).toEqual({ count: 3 })
  })

  it('rotates the log file to .old.log once it exceeds the size cap', () => {
    initLogger()
    const logPath = getLogPath()
    // Push the file well past the 5MB rotation threshold in one write.
    log.info('bulk', 'x'.repeat(6 * 1024 * 1024))

    // Rotation is only checked on the next init, simulating the next launch.
    initLogger()

    const oldLogPath = logPath.replace(/\.log$/, '.old.log')
    expect(readFileSync(oldLogPath, 'utf8')).toContain('bulk')
    // The active log now only has the fresh startup line from re-init.
    expect(readLines(logPath)).toHaveLength(1)
  })

  it('logging never crashes the app even if the write itself fails', () => {
    initLogger()
    appendFileSyncMock.mockImplementation(() => {
      throw new Error('disk full')
    })
    expect(() => log.info('chat', 'this will fail to persist')).not.toThrow()
  })
})
