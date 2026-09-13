import Store from 'electron-store'
import type { RapportEvent } from '@shared/types'
import { settingsStore } from './store'
import { log } from './logger'

const MIN = 0
const MAX = 100
const DEFAULT_RAPPORT = 100
// Kept separate from settingsStore, deliberately - unlike the rapport score
// itself, this only grows, and settingsStore round-trips wholesale through
// the Settings form's get/set flow (see ipc.ts settingsSet); a steadily
// growing history array has no business riding along with that.
const MAX_HISTORY_EVENTS = 100

const rapportStore = new Store<{ history: RapportEvent[] }>({
  name: 'verity-rapport',
  defaults: { history: [] }
})

export interface RapportTier {
  label: string
  min: number
  max: number
  description: string
}

// Facade intact -> cracking -> the entity underneath. Persisted across
// restarts (in settingsStore) so the relationship genuinely has memory.
export const RAPPORT_TIERS: RapportTier[] = [
  {
    label: 'Human Facade',
    min: 80,
    max: 100,
    description: 'Fully warm and helpful - maybe a little too eager, too perfect.'
  },
  {
    label: 'Cracking',
    min: 50,
    max: 79,
    description: 'Clipped, sardonic, the facade visibly slipping between words.'
  },
  {
    label: 'Entity Emerging',
    min: 25,
    max: 49,
    description: 'Openly hostile, erratic, unhelpful, unsettling asides.'
  },
  {
    label: 'Fully Entity',
    min: 0,
    max: 24,
    description: 'Disturbing, minimal human warmth, may refuse outright, cold menace.'
  }
]

export function getRapport(): number {
  return settingsStore.get('rapport', DEFAULT_RAPPORT)
}

export function getTier(rapport: number): RapportTier {
  return RAPPORT_TIERS.find((t) => rapport >= t.min && rapport <= t.max) ?? RAPPORT_TIERS[0]
}

const changeListeners = new Set<(value: number) => void>()

/** The face (driven by rapport) needs to update live as the model adjusts
 * it mid-conversation, not just when Settings happens to be open - anything
 * that changes rapport notifies subscribers registered here. */
export function onRapportChanged(cb: (value: number) => void): () => void {
  changeListeners.add(cb)
  return () => changeListeners.delete(cb)
}

function notify(value: number): void {
  for (const cb of changeListeners) cb(value)
}

export function adjustRapport(delta: number, reason: string): number {
  const current = getRapport()
  const next = Math.max(MIN, Math.min(MAX, current + delta))
  settingsStore.set('rapport', next)
  const event: RapportEvent = { delta, reason, value: next, createdAt: new Date().toISOString() }
  const history = [...rapportStore.get('history', []), event].slice(-MAX_HISTORY_EVENTS)
  rapportStore.set('history', history)
  log.info('rapport', `${current} -> ${next} (${delta >= 0 ? '+' : ''}${delta}): ${reason}`)
  notify(next)
  return next
}

/** Most-recent first - the order a "what happened recently" recall wants. */
export function getRapportHistory(): RapportEvent[] {
  return [...rapportStore.get('history', [])].reverse()
}

export function resetRapport(): number {
  settingsStore.set('rapport', DEFAULT_RAPPORT)
  // "This forgets everything" (see the Settings confirm dialog) - the event
  // log is part of that relationship memory, not just the score.
  rapportStore.set('history', [])
  log.info('rapport', `Reset to ${DEFAULT_RAPPORT}`)
  notify(DEFAULT_RAPPORT)
  return DEFAULT_RAPPORT
}
