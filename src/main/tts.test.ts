import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FishAudioSettings } from '@shared/types'
import { FishAudioError, synthesizeFishAudio } from './tts'

const cfg = (overrides: Partial<FishAudioSettings> = {}): FishAudioSettings => ({
  baseUrl: 'http://localhost:8080',
  apiKey: 'secret-key',
  referenceId: '',
  format: 'wav',
  ...overrides
})

function okAudio(bytes = new Uint8Array([1, 2, 3, 4])): Response {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer,
    text: async () => ''
  } as unknown as Response
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async () => okAudio())
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('synthesizeFishAudio', () => {
  it('POSTs JSON to <baseUrl>/v1/tts with a bearer token and the text', async () => {
    await synthesizeFishAudio('Hello there.', cfg())

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8080/v1/tts')
    expect(init.method).toBe('POST')
    expect(init.headers['content-type']).toBe('application/json')
    expect(init.headers.authorization).toBe('Bearer secret-key')

    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ text: 'Hello there.', format: 'wav', streaming: false })
    expect(body).not.toHaveProperty('reference_id')
  })

  it('trims a trailing slash off the base URL', async () => {
    await synthesizeFishAudio('hi', cfg({ baseUrl: 'http://localhost:8080/' }))
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8080/v1/tts')
  })

  it('includes reference_id only when a non-blank one is configured', async () => {
    await synthesizeFishAudio('hi', cfg({ referenceId: '  voice-42  ' }))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reference_id).toBe('voice-42')
  })

  it('omits the Authorization header when no api key is set', async () => {
    await synthesizeFishAudio('hi', cfg({ apiKey: '' }))
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('authorization')
  })

  it('returns the raw audio bytes on success', async () => {
    const out = await synthesizeFishAudio('hi', cfg())
    expect(out).toBeInstanceOf(Uint8Array)
    expect([...out]).toEqual([1, 2, 3, 4])
  })

  it('throws FishAudioError with the status on a non-2xx response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'unauthorized'
    } as unknown as Response)

    const err = await synthesizeFishAudio('hi', cfg()).catch((e) => e)
    expect(err).toBeInstanceOf(FishAudioError)
    expect(err.message).toMatch(/401/)
  })

  it('throws FishAudioError when the server returns an empty body', async () => {
    fetchMock.mockResolvedValue(okAudio(new Uint8Array()))
    await expect(synthesizeFishAudio('hi', cfg())).rejects.toThrow(/no audio/)
  })

  it('throws FishAudioError when there is no server URL', async () => {
    await expect(synthesizeFishAudio('hi', cfg({ baseUrl: '   ' }))).rejects.toThrow(/URL/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('wraps a network failure in FishAudioError', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(synthesizeFishAudio('hi', cfg())).rejects.toBeInstanceOf(FishAudioError)
  })
})
