import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron')
vi.mock('electron-store')

import { Notification } from 'electron'
import { cancelReminder, getReminders, initReminders, scheduleReminder } from './reminders'

const NotificationMock = Notification as unknown as {
  isSupported: ReturnType<typeof vi.fn>
  instances: { opts: { title?: string; body?: string } }[]
}

function clearAll(): void {
  for (const r of getReminders()) cancelReminder(r.id)
}

beforeEach(() => {
  clearAll()
  vi.mocked(Notification.isSupported).mockReturnValue(true)
  NotificationMock.instances.length = 0
})

describe('scheduleReminder', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    clearAll()
    vi.useRealTimers()
  })

  it('persists a pending reminder immediately', () => {
    scheduleReminder(5, 'stretch')
    expect(getReminders()).toMatchObject([{ message: 'stretch' }])
  })

  it('fires a notification and removes itself once the delay elapses', () => {
    scheduleReminder(5, 'stretch')
    vi.advanceTimersByTime(5 * 60_000)

    expect(NotificationMock.instances.at(-1)?.opts).toEqual({ title: 'Verity', body: 'stretch' })
    expect(getReminders()).toEqual([])
  })

  it('sorts pending reminders soonest-first', () => {
    scheduleReminder(30, 'later')
    scheduleReminder(5, 'sooner')
    expect(getReminders().map((r) => r.message)).toEqual(['sooner', 'later'])
  })
})

describe('cancelReminder', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('removes a pending reminder and its notification never fires', () => {
    scheduleReminder(5, 'stretch')
    const [reminder] = getReminders()

    expect(cancelReminder(reminder.id)).toEqual([])

    vi.advanceTimersByTime(5 * 60_000)
    expect(NotificationMock.instances).toHaveLength(0)
  })

  it('is a harmless no-op for an unknown id', () => {
    expect(cancelReminder('does-not-exist')).toEqual([])
  })
})

describe('initReminders', () => {
  afterEach(() => vi.useRealTimers())

  it('re-arms a still-future reminder found on disk', () => {
    vi.useFakeTimers()
    scheduleReminder(10, 'future')
    // Simulate a restart: only the persisted record survives, not the
    // in-memory setTimeout handle from the scheduleReminder call above.
    initReminders()

    vi.advanceTimersByTime(10 * 60_000)
    expect(NotificationMock.instances.at(-1)?.opts).toMatchObject({ body: 'future' })
  })

  it('fires immediately a reminder that is mildly overdue (closed <1h ago)', () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00.000Z') })
    scheduleReminder(10, 'missed-it')
    // Jump forward as if the app was closed and reopened 30 minutes after
    // the reminder should have fired (10 min delay + 20 min more).
    vi.setSystemTime(new Date('2026-01-01T00:30:00.000Z'))

    initReminders()
    vi.advanceTimersByTime(1)

    expect(NotificationMock.instances.at(-1)?.opts).toMatchObject({ body: 'missed-it' })
  })

  it('drops a reminder overdue by more than an hour instead of firing it late', () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00.000Z') })
    scheduleReminder(10, 'very-stale')
    vi.setSystemTime(new Date('2026-01-01T02:00:00.000Z'))

    initReminders()
    vi.advanceTimersByTime(1)

    expect(NotificationMock.instances).toHaveLength(0)
    expect(getReminders()).toEqual([])
  })
})
