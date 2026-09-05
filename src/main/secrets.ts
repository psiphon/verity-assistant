import { safeStorage } from 'electron'
import type { AppSettings } from '@shared/types'
import { log } from './logger'

// Values persisted by electron-store land in a plaintext JSON file under the
// user's profile. API keys and MCP server env (which routinely holds tokens)
// must not sit there in the clear - wrap them with the OS keychain / DPAPI
// via Electron's safeStorage. Ciphertext is tagged so we can tell an
// already-encrypted value from a fresh one and migrate transparently.
const PREFIX = 'enc:v1:'

function available(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function encryptSecret(plain: string): string {
  if (!plain || plain.startsWith(PREFIX)) return plain
  if (!available()) return plain
  try {
    return PREFIX + safeStorage.encryptString(plain).toString('base64')
  } catch (err) {
    log.warn('secrets', 'encryptString failed - storing value unencrypted', err)
    return plain
  }
}

export function decryptSecret(value: string): string {
  if (!value || !value.startsWith(PREFIX)) return value
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(PREFIX.length), 'base64'))
  } catch (err) {
    log.warn('secrets', 'decryptString failed - dropping value', err)
    return ''
  }
}

type Transform = (s: string) => string

function mapSecretFields(settings: AppSettings, fn: Transform): AppSettings {
  return {
    ...settings,
    providers: Object.fromEntries(
      Object.entries(settings.providers).map(([id, p]) => [id, { ...p, apiKey: fn(p.apiKey) }])
    ) as AppSettings['providers'],
    mcpServers: settings.mcpServers.map((s) => ({
      ...s,
      env: s.env ? Object.fromEntries(Object.entries(s.env).map(([k, v]) => [k, fn(v)])) : s.env
    }))
  }
}

/** Encrypt every secret field - call before persisting a settings payload. */
export function encryptSettingsSecrets(settings: AppSettings): AppSettings {
  return mapSecretFields(settings, encryptSecret)
}

/** Decrypt every secret field - call after reading persisted settings, before
 * the values are used or handed to the renderer. */
export function decryptSettingsSecrets(settings: AppSettings): AppSettings {
  return mapSecretFields(settings, decryptSecret)
}
