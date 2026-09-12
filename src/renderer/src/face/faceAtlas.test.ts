import { describe, expect, it } from 'vitest'
import { FACE_PACKS, resolveFacePack, selectSlot } from './faceAtlas'
import type { FaceSlot } from './faceAtlas'

const ALL_SLOTS: FaceSlot[] = [
  'thinking',
  'talkingWarm',
  'talkingCold',
  'restWarm',
  'restNeutral',
  'restCool',
  'restCold'
]

describe('selectSlot', () => {
  it('always shows the thinking slot while thinking, regardless of rapport', () => {
    expect(selectSlot('thinking', 100)).toBe('thinking')
    expect(selectSlot('thinking', 0)).toBe('thinking')
  })

  it('shows the warm talking slot above the rapport threshold', () => {
    expect(selectSlot('talking', 61)).toBe('talkingWarm')
    expect(selectSlot('talking', 100)).toBe('talkingWarm')
  })

  it('shows the cold talking slot at or below the rapport threshold', () => {
    expect(selectSlot('talking', 60)).toBe('talkingCold')
    expect(selectSlot('talking', 0)).toBe('talkingCold')
  })

  it('picks the resting slot from the highest rapport tier down', () => {
    expect(selectSlot('resting', 100)).toBe('restWarm')
    expect(selectSlot('resting', 76)).toBe('restWarm')
    expect(selectSlot('resting', 75)).toBe('restNeutral')
    expect(selectSlot('resting', 51)).toBe('restNeutral')
    expect(selectSlot('resting', 50)).toBe('restCool')
    expect(selectSlot('resting', 31)).toBe('restCool')
    expect(selectSlot('resting', 30)).toBe('restCold')
    expect(selectSlot('resting', 0)).toBe('restCold')
  })
})

describe('FACE_PACKS', () => {
  it('every pack fills all seven slots with a distinct image', () => {
    for (const [id, pack] of Object.entries(FACE_PACKS)) {
      const urls = ALL_SLOTS.map((slot) => pack.slots[slot])
      expect(urls.every(Boolean), `${id} has a gap`).toBe(true)
      expect(new Set(urls).size, `${id} reuses an image`).toBe(ALL_SLOTS.length)
    }
  })
})

describe('resolveFacePack', () => {
  it('returns the named pack', () => {
    expect(resolveFacePack('meeseeks')).toBe(FACE_PACKS.meeseeks)
  })

  it('falls back to the default pack for an unknown id', () => {
    expect(resolveFacePack('nonsense')).toBe(FACE_PACKS.photos)
  })
})
