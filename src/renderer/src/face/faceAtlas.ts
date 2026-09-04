import happy from '../assets/faces/happy.png'
import smiling from '../assets/faces/smiling.png'
import creepySmile from '../assets/faces/creepy_smile.png'
import grimace from '../assets/faces/grimace.png'
import appalled from '../assets/faces/appalled.png'
import unimpressed from '../assets/faces/unimpressed.png'
import unsatisfied from '../assets/faces/unsatisfied.png'

/** Circle-cropped face photos (see scripts/circle-crop-faces.mjs, run
 * against assets/faces/*.jpg|png). */
const SPRITE_URLS = {
  happy,
  smiling,
  creepySmile,
  grimace,
  appalled,
  unimpressed,
  unsatisfied
} as const

export type SpriteName = keyof typeof SPRITE_URLS

export const SPRITE_URL: Record<SpriteName, string> = SPRITE_URLS

export type FaceState = 'resting' | 'thinking' | 'talking'

/**
 * The face is fully determined by what she's doing right now (resting /
 * thinking / talking) and the current rapport score - not by anything the
 * model picks. Deterministic and always in sync with the relationship,
 * rather than depending on the model remembering to call a mood tool.
 */
export function selectFace(state: FaceState, rapport: number): SpriteName {
  if (state === 'thinking') return 'grimace'

  if (state === 'talking') return rapport > 60 ? 'happy' : 'appalled'

  // resting
  if (rapport > 75) return 'smiling'
  if (rapport > 50) return 'creepySmile'
  if (rapport > 30) return 'unimpressed'
  return 'unsatisfied'
}
