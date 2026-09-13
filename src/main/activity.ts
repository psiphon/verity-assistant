import { randomUUID } from 'node:crypto'
import Store from 'electron-store'
import type { ActivityEntry } from '@shared/types'

const MAX_ACTIVITY_ENTRIES = 200
// One line per entry, spliced into a Settings list a human actually reads -
// cap it so one call with a huge argument (a long file path, a big text
// blob) can't make the list unreadable or balloon the store.
const MAX_SUMMARY_CHARS = 160

const activityStore = new Store<{ entries: ActivityEntry[] }>({
  name: 'verity-activity',
  defaults: { entries: [] }
})

/** One-line, human-readable summary of a tool call - not a security log (the
 * debug log already has the full args), just enough for "what did she just
 * do" at a glance. */
function summarize(tool: string, input: Record<string, unknown>): string {
  const args = Object.entries(input)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(', ')
  const line = args ? `${tool}(${args})` : `${tool}()`
  return line.length > MAX_SUMMARY_CHARS ? `${line.slice(0, MAX_SUMMARY_CHARS)}…` : line
}

export function logActivity(tool: string, input: Record<string, unknown>): ActivityEntry {
  const entry: ActivityEntry = {
    id: randomUUID(),
    tool,
    summary: summarize(tool, input),
    createdAt: new Date().toISOString()
  }
  const entries = [...getActivity(), entry].slice(-MAX_ACTIVITY_ENTRIES)
  activityStore.set('entries', entries)
  return entry
}

export function getActivity(): ActivityEntry[] {
  return activityStore.get('entries', [])
}

export function clearActivity(): void {
  activityStore.set('entries', [])
}
