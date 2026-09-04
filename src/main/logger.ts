import { app } from 'electron'
import { appendFileSync, mkdirSync, statSync, renameSync, existsSync } from 'fs'
import { join } from 'path'

const MAX_LOG_BYTES = 5 * 1024 * 1024

let logPath = ''

export function initLogger(): void {
  const dir = join(app.getPath('userData'), 'logs')
  mkdirSync(dir, { recursive: true })
  logPath = join(dir, 'verity.log')
  rotateIfNeeded()
  write(
    'info',
    'app',
    `Verity starting - version ${app.getVersion()}, platform ${process.platform}`
  )
}

export function getLogPath(): string {
  return logPath
}

function rotateIfNeeded(): void {
  if (!existsSync(logPath)) return
  try {
    if (statSync(logPath).size > MAX_LOG_BYTES) {
      renameSync(logPath, logPath.replace(/\.log$/, '.old.log'))
    }
  } catch {
    // best-effort rotation
  }
}

function write(
  level: 'info' | 'warn' | 'error',
  scope: string,
  message: string,
  data?: unknown
): void {
  const line = {
    t: new Date().toISOString(),
    level,
    scope,
    message,
    ...(data !== undefined ? { data: serialize(data) } : {})
  }
  const text = JSON.stringify(line) + '\n'
  if (level === 'error') console.error(`[${scope}] ${message}`, data ?? '')
  else if (level === 'warn') console.warn(`[${scope}] ${message}`, data ?? '')
  else console.log(`[${scope}] ${message}`, data ?? '')

  if (!logPath) return
  try {
    appendFileSync(logPath, text)
  } catch {
    // logging must never crash the app
  }
}

function serialize(data: unknown): unknown {
  if (data instanceof Error) {
    // SDK errors (Anthropic/OpenAI APIError) attach extra fields like
    // status/error/code beyond the standard Error shape - keep them.
    const extra = { ...data } as Record<string, unknown>
    return { name: data.name, message: data.message, stack: data.stack, ...extra }
  }
  return data
}

export const log = {
  info: (scope: string, message: string, data?: unknown) => write('info', scope, message, data),
  warn: (scope: string, message: string, data?: unknown) => write('warn', scope, message, data),
  error: (scope: string, message: string, data?: unknown) => write('error', scope, message, data)
}
