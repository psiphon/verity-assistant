import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron-store')
vi.mock('electron')

import {
  RAPPORT_TIERS,
  adjustRapport,
  getRapport,
  getRapportHistory,
  getTier,
  onRapportChanged,
  resetRapport
} from './rapport'

describe('rapport', () => {
  beforeEach(() => {
    resetRapport()
  })

  it('starts at the default of 100', () => {
    expect(getRapport()).toBe(100)
  })

  it('clamps adjustments to the 0-100 range', () => {
    expect(adjustRapport(-500, 'brutal')).toBe(0)
    expect(adjustRapport(1000, 'overcorrect')).toBe(100)
  })

  it('applies a normal in-range delta additively', () => {
    adjustRapport(-30, 'rude')
    expect(getRapport()).toBe(70)
    adjustRapport(5, 'apology')
    expect(getRapport()).toBe(75)
  })

  it('persists across calls to getRapport', () => {
    adjustRapport(-40, 'insult')
    expect(getRapport()).toBe(60)
    expect(getRapport()).toBe(60)
  })

  it('resetRapport returns to 100 and getRapport reflects it', () => {
    adjustRapport(-90, 'cruelty')
    expect(resetRapport()).toBe(100)
    expect(getRapport()).toBe(100)
  })

  it('notifies subscribers on adjustRapport and resetRapport', () => {
    const cb = vi.fn()
    const unsubscribe = onRapportChanged(cb)

    adjustRapport(-10, 'curt')
    expect(cb).toHaveBeenCalledWith(90)

    resetRapport()
    expect(cb).toHaveBeenCalledWith(100)
    expect(cb).toHaveBeenCalledTimes(2)

    unsubscribe()
    adjustRapport(-10, 'curt again')
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it('supports multiple independent subscribers', () => {
    const a = vi.fn()
    const b = vi.fn()
    onRapportChanged(a)
    onRapportChanged(b)
    adjustRapport(-1, 'x')
    expect(a).toHaveBeenCalledWith(99)
    expect(b).toHaveBeenCalledWith(99)
  })

  describe('getRapportHistory', () => {
    it('starts empty', () => {
      expect(getRapportHistory()).toEqual([])
    })

    it('records each adjustment, most recent first, with the resulting value', () => {
      adjustRapport(-10, 'curt')
      adjustRapport(5, 'apology')

      const history = getRapportHistory()
      expect(history).toHaveLength(2)
      expect(history[0]).toMatchObject({ delta: 5, reason: 'apology', value: 95 })
      expect(history[1]).toMatchObject({ delta: -10, reason: 'curt', value: 90 })
    })

    it('is cleared by resetRapport, matching its "forgets everything" contract', () => {
      adjustRapport(-20, 'rude')
      resetRapport()
      expect(getRapportHistory()).toEqual([])
    })
  })

  describe('getTier', () => {
    it('covers every tier boundary with no gaps or overlaps', () => {
      expect(getTier(100).label).toBe('Human Facade')
      expect(getTier(80).label).toBe('Human Facade')
      expect(getTier(79).label).toBe('Cracking')
      expect(getTier(50).label).toBe('Cracking')
      expect(getTier(49).label).toBe('Entity Emerging')
      expect(getTier(25).label).toBe('Entity Emerging')
      expect(getTier(24).label).toBe('Fully Entity')
      expect(getTier(0).label).toBe('Fully Entity')
    })

    it('falls back to the first tier for an out-of-range value', () => {
      expect(getTier(150)).toBe(RAPPORT_TIERS[0])
      expect(getTier(-10)).toBe(RAPPORT_TIERS[0])
    })
  })
})
