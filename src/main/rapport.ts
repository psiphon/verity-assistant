import { settingsStore } from './store'
import { log } from './logger'

const MIN = 0
const MAX = 100
const DEFAULT_RAPPORT = 100

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
  log.info('rapport', `${current} -> ${next} (${delta >= 0 ? '+' : ''}${delta}): ${reason}`)
  notify(next)
  return next
}

export function resetRapport(): number {
  settingsStore.set('rapport', DEFAULT_RAPPORT)
  log.info('rapport', `Reset to ${DEFAULT_RAPPORT}`)
  notify(DEFAULT_RAPPORT)
  return DEFAULT_RAPPORT
}
