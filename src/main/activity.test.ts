import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron-store')

import { clearActivity, getActivity, logActivity } from './activity'

describe('activity', () => {
  beforeEach(() => {
    clearActivity()
  })

  it('starts empty', () => {
    expect(getActivity()).toEqual([])
  })

  it('logs a call with a readable summary, id, and timestamp', () => {
    const entry = logActivity('play_sound', { sound: 'chime' })
    expect(entry.tool).toBe('play_sound')
    expect(entry.summary).toBe('play_sound(sound: chime)')
    expect(entry.id).toBeTruthy()
    expect(new Date(entry.createdAt).toString()).not.toBe('Invalid Date')
    expect(getActivity()).toEqual([entry])
  })

  it('summarizes a no-arg call without a trailing empty parens list', () => {
    const entry = logActivity('get_current_time', {})
    expect(entry.summary).toBe('get_current_time()')
  })

  it('appends rather than replacing on repeated calls', () => {
    logActivity('a', {})
    logActivity('b', {})
    expect(getActivity().map((a) => a.tool)).toEqual(['a', 'b'])
  })

  it('truncates an oversized summary', () => {
    const entry = logActivity('read_text_file', { path: 'x'.repeat(300) })
    expect(entry.summary.length).toBeLessThanOrEqual(161)
  })

  it('caps stored entries at 200, dropping the oldest', () => {
    for (let i = 0; i < 205; i++) logActivity('t', { i })
    const entries = getActivity()
    expect(entries).toHaveLength(200)
    expect(entries[0].summary).toBe('t(i: 5)')
    expect(entries[entries.length - 1].summary).toBe('t(i: 204)')
  })

  it('clearActivity empties the list', () => {
    logActivity('a', {})
    clearActivity()
    expect(getActivity()).toEqual([])
  })
})
