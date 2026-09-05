import { describe, expect, it } from 'vitest'
import { extractFallbackToolCalls, extractStageDirectionSounds } from './fallbackToolCalls'

describe('extractFallbackToolCalls', () => {
  it('returns the text unchanged when there are no known tool names', () => {
    const result = extractFallbackToolCalls('play_sound{"sound": "chime"}', [])
    expect(result).toEqual({ cleanedText: 'play_sound{"sound": "chime"}', calls: [] })
  })

  it('extracts a leaked call with parenthesized JSON and strips it', () => {
    const { cleanedText, calls } = extractFallbackToolCalls(
      'Sure thing. play_sound({"sound": "chime"}) Anything else?',
      ['play_sound']
    )
    expect(calls).toEqual([{ name: 'play_sound', input: { sound: 'chime' } }])
    expect(cleanedText).toBe('Sure thing. Anything else?')
  })

  it('extracts a leaked call without parentheses (bare name + JSON)', () => {
    const { cleanedText, calls } = extractFallbackToolCalls(
      '-play_sound{"sound": "glitch"}\nYou’re right.',
      ['play_sound', 'adjust_rapport']
    )
    expect(calls).toEqual([{ name: 'play_sound', input: { sound: 'glitch' } }])
    expect(cleanedText).toBe('You’re right.')
  })

  it('extracts multiple distinct tool calls in one reply', () => {
    const { calls } = extractFallbackToolCalls(
      'adjust_rapport({"delta": -5, "reason": "rude"}) play_sound({"sound": "stinger"})',
      ['adjust_rapport', 'play_sound']
    )
    expect(calls).toEqual([
      { name: 'adjust_rapport', input: { delta: -5, reason: 'rude' } },
      { name: 'play_sound', input: { sound: 'stinger' } }
    ])
  })

  it('leaves malformed JSON in place rather than dropping it silently', () => {
    const input = 'play_sound({sound: chime)'
    const { cleanedText, calls } = extractFallbackToolCalls(input, ['play_sound'])
    expect(calls).toEqual([])
    expect(cleanedText).toBe(input)
  })

  it('does not match a tool name that only appears in prose with no JSON', () => {
    const input = 'I could use play_sound if you want me to.'
    const { cleanedText, calls } = extractFallbackToolCalls(input, ['play_sound'])
    expect(calls).toEqual([])
    expect(cleanedText).toBe(input)
  })

  it('collapses excess blank lines left behind after stripping', () => {
    const { cleanedText } = extractFallbackToolCalls(
      'Line one.\nplay_sound({"sound": "chime"})\n\n\n\nLine two.',
      ['play_sound']
    )
    expect(cleanedText).toBe('Line one.\n\nLine two.')
  })

  it('escapes regex-special characters in tool names', () => {
    const { calls } = extractFallbackToolCalls('mcp__weird.name({"a": 1})', ['mcp__weird.name'])
    expect(calls).toEqual([{ name: 'mcp__weird.name', input: { a: 1 } }])
  })
})

describe('extractStageDirectionSounds', () => {
  const SFX = ['chime', 'glitch', 'hum', 'stinger'] as const

  it('returns the text unchanged when there are no sfx names configured', () => {
    const result = extractStageDirectionSounds('*glitch*', [])
    expect(result).toEqual({ cleanedText: '*glitch*', sounds: [] })
  })

  it('extracts an asterisk-wrapped stage direction and strips it', () => {
    const { cleanedText, sounds } = extractStageDirectionSounds(
      '*glitch*\nYou’re right. I’m not here to protect you. *glitch*',
      SFX
    )
    expect(sounds).toEqual(['glitch', 'glitch'])
    expect(cleanedText).toBe('You’re right. I’m not here to protect you.')
  })

  it('extracts a bracket-wrapped stage direction', () => {
    const { cleanedText, sounds } = extractStageDirectionSounds('[stinger] Careful now.', SFX)
    expect(sounds).toEqual(['stinger'])
    expect(cleanedText).toBe('Careful now.')
  })

  it('is case-insensitive and lowercases the reported sound name', () => {
    const { sounds } = extractStageDirectionSounds('*GLITCH*', SFX)
    expect(sounds).toEqual(['glitch'])
  })

  it('ignores a word that is not a known sound effect', () => {
    const input = '*laughs* that is funny'
    const { cleanedText, sounds } = extractStageDirectionSounds(input, SFX)
    expect(sounds).toEqual([])
    expect(cleanedText).toBe(input)
  })

  it('leaves plain prose mentioning a sound name untouched', () => {
    const input = 'I could play a chime for you.'
    const { cleanedText, sounds } = extractStageDirectionSounds(input, SFX)
    expect(sounds).toEqual([])
    expect(cleanedText).toBe(input)
  })
})
