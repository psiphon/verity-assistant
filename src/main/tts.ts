import type { FishAudioSettings } from '@shared/types'

// How long to wait on the fish-speech server before giving up and letting the
// renderer fall back to the system voice. A cold `--compile` server can take
// ~1 min on its very first request; after that a short reply is a few seconds.
const SYNTHESIS_TIMEOUT_MS = 90_000

export class FishAudioError extends Error {}

/**
 * Ask a self-hosted fish-speech / OpenAudio server to synthesize `text`.
 * Returns the raw encoded audio bytes (wav/mp3/opus per `cfg.format`).
 *
 * Only ever called from the main process - the renderer's CSP forbids it from
 * reaching arbitrary hosts, and this keeps the bearer token out of any browser
 * context. See docs at docker/fish-audio/README.md.
 */
export async function synthesizeFishAudio(
  text: string,
  cfg: FishAudioSettings
): Promise<Uint8Array> {
  const base = cfg.baseUrl.trim().replace(/\/+$/, '')
  if (!base) throw new FishAudioError('No Fish Audio server URL configured')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SYNTHESIS_TIMEOUT_MS)
  try {
    const res = await fetch(`${base}/v1/tts`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {})
      },
      // The server accepts application/json as well as msgpack; JSON keeps this
      // dependency-free. Non-streaming so we get one complete file back.
      body: JSON.stringify({
        text,
        format: cfg.format,
        chunk_length: 200,
        normalize: true,
        streaming: false,
        ...(cfg.referenceId.trim() ? { reference_id: cfg.referenceId.trim() } : {})
      }),
      signal: controller.signal
    })

    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200)
      throw new FishAudioError(
        `Fish Audio server responded ${res.status}${detail ? `: ${detail}` : ''}`
      )
    }

    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.byteLength === 0) throw new FishAudioError('Fish Audio server returned no audio')
    return bytes
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new FishAudioError(`Fish Audio server timed out after ${SYNTHESIS_TIMEOUT_MS}ms`)
    }
    if (err instanceof FishAudioError) throw err
    throw new FishAudioError(err instanceof Error ? err.message : String(err))
  } finally {
    clearTimeout(timer)
  }
}
