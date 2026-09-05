import { describe, expect, it } from 'vitest'
import { selectFace } from './faceAtlas'

describe('selectFace', () => {
  it('always shows grimace while thinking, regardless of rapport', () => {
    expect(selectFace('thinking', 100)).toBe('grimace')
    expect(selectFace('thinking', 0)).toBe('grimace')
  })

  it('shows happy while talking above the rapport threshold', () => {
    expect(selectFace('talking', 61)).toBe('happy')
    expect(selectFace('talking', 100)).toBe('happy')
  })

  it('shows appalled while talking at or below the rapport threshold', () => {
    expect(selectFace('talking', 60)).toBe('appalled')
    expect(selectFace('talking', 0)).toBe('appalled')
  })

  it('picks the resting face from the highest rapport tier down', () => {
    expect(selectFace('resting', 100)).toBe('smiling')
    expect(selectFace('resting', 76)).toBe('smiling')
    expect(selectFace('resting', 75)).toBe('creepySmile')
    expect(selectFace('resting', 51)).toBe('creepySmile')
    expect(selectFace('resting', 50)).toBe('unimpressed')
    expect(selectFace('resting', 31)).toBe('unimpressed')
    expect(selectFace('resting', 30)).toBe('unsatisfied')
    expect(selectFace('resting', 0)).toBe('unsatisfied')
  })
})
