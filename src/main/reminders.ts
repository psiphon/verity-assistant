import { randomUUID } from 'node:crypto'
import Store from 'electron-store'
import { Notification } from 'electron'
import type { Reminder } from '@shared/types'
import { log } from './logger'

const MAX_REMINDERS = 50
// A reminder that was due more than this long ago while Verity wasn't
// running gets dropped rather than fired late - mirrors the existing
// "skip a stale ambient tick" philosophy (see AMBIENT_MAX_IDLE_SECONDS in
// ipc.ts): a very late notification is more confusing than helpful.
const MAX_OVERDUE_MS = 60 * 60_000

const reminderStore = new Store<{ reminders: Reminder[] }>({
  name: 'verity-reminders',
  defaults: { reminders: [] }
})

// setTimeout handles aren't persistable - re-armed from disk on every
// startup (see initReminders) and tracked here so a user-initiated cancel
// can clear the pending timer, not just the stored record.
const activeTimers = new Map<string, ReturnType<typeof setTimeout>>()

function persist(reminders: Reminder[]): void {
  reminderStore.set('reminders', reminders)
}

export function getReminders(): Reminder[] {
  return [...reminderStore.get('reminders', [])].sort((a, b) => a.fireAt.localeCompare(b.fireAt))
}

function fire(id: string): void {
  activeTimers.delete(id)
  const reminders = reminderStore.get('reminders', [])
  const reminder = reminders.find((r) => r.id === id)
  if (!reminder) return
  persist(reminders.filter((r) => r.id !== id))
  if (Notification.isSupported()) {
    new Notification({ title: 'Verity', body: reminder.message }).show()
  }
  log.info('reminders', `Fired: ${reminder.message}`)
}

function arm(reminder: Reminder, delayMs: number): void {
  activeTimers.set(
    reminder.id,
    setTimeout(() => fire(reminder.id), delayMs)
  )
}

export function scheduleReminder(minutesInput: unknown, messageInput: unknown): string {
  const minutes = Math.max(0.1, Math.min(180, Number(minutesInput) || 1))
  const message = String(messageInput ?? '').trim() || 'Reminder!'
  const reminder: Reminder = {
    id: randomUUID(),
    message,
    fireAt: new Date(Date.now() + minutes * 60_000).toISOString(),
    createdAt: new Date().toISOString()
  }
  const reminders = [...reminderStore.get('reminders', []), reminder].slice(-MAX_REMINDERS)
  persist(reminders)
  arm(reminder, minutes * 60_000)
  return `Okay, I'll remind you in ${minutes} minute(s): "${message}"`
}

export function cancelReminder(id: string): Reminder[] {
  const timer = activeTimers.get(id)
  if (timer) {
    clearTimeout(timer)
    activeTimers.delete(id)
  }
  persist(reminderStore.get('reminders', []).filter((r) => r.id !== id))
  return getReminders()
}

/** Re-arms every still-future reminder on disk (setTimeout handles don't
 * survive a restart) - called once from main/index.ts at startup. A
 * reminder that was due while Verity was closed fires immediately if it's
 * only mildly overdue, or is dropped outright if very stale. */
export function initReminders(): void {
  const reminders = reminderStore.get('reminders', [])
  const now = Date.now()
  const kept: Reminder[] = []

  for (const reminder of reminders) {
    const delayMs = new Date(reminder.fireAt).getTime() - now
    if (delayMs > 0) {
      kept.push(reminder)
      arm(reminder, delayMs)
    } else if (delayMs >= -MAX_OVERDUE_MS) {
      kept.push(reminder)
      arm(reminder, 0)
    } else {
      log.info('reminders', `Dropping stale reminder: ${reminder.message}`)
    }
  }
  if (kept.length !== reminders.length) persist(kept)
}
