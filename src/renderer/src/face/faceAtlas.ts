import type { FacePackId } from '@shared/types'

import photoHappy from '../assets/faces/happy.png'
import photoSmiling from '../assets/faces/smiling.png'
import photoCreepySmile from '../assets/faces/creepy_smile.png'
import photoGrimace from '../assets/faces/grimace.png'
import photoAppalled from '../assets/faces/appalled.png'
import photoUnimpressed from '../assets/faces/unimpressed.png'
import photoUnsatisfied from '../assets/faces/unsatisfied.png'

import mkHappy from '../assets/faces-meeseeks/happy.png'
import mkContent from '../assets/faces-meeseeks/content.png'
import mkManic from '../assets/faces-meeseeks/manic.png'
import mkGlum from '../assets/faces-meeseeks/glum.png'
import mkPained from '../assets/faces-meeseeks/pained.png'
import mkAngry from '../assets/faces-meeseeks/angry.png'
import mkFrustrated from '../assets/faces-meeseeks/frustrated.png'

/**
 * The face is fully determined by what she's doing right now (resting /
 * thinking / talking) and the current rapport score - not by anything the
 * model picks. Deterministic and always in sync with the relationship,
 * rather than depending on the model remembering to call a mood tool.
 *
 * A "face pack" is a set of images filling these seven abstract slots. Which
 * pack is active is a user setting (`facePack`); `selectSlot` picks the slot,
 * the pack decides what that slot looks like.
 */
export type FaceSlot =
  'thinking' | 'talkingWarm' | 'talkingCold' | 'restWarm' | 'restNeutral' | 'restCool' | 'restCold'

export type FaceState = 'resting' | 'thinking' | 'talking'

export interface FacePack {
  label: string
  /** Circle-cropped face images, one per slot (see
   * scripts/circle-crop-faces.mjs). */
  slots: Record<FaceSlot, string>
}

export const FACE_PACKS: Record<FacePackId, FacePack> = {
  photos: {
    label: 'Photos',
    slots: {
      thinking: photoGrimace,
      talkingWarm: photoHappy,
      talkingCold: photoAppalled,
      restWarm: photoSmiling,
      restNeutral: photoCreepySmile,
      restCool: photoUnimpressed,
      restCold: photoUnsatisfied
    }
  },
  meeseeks: {
    label: 'Meeseeks',
    slots: {
      thinking: mkPained,
      talkingWarm: mkHappy,
      talkingCold: mkAngry,
      restWarm: mkContent,
      restNeutral: mkManic,
      restCool: mkGlum,
      restCold: mkFrustrated
    }
  }
}

export const DEFAULT_FACE_PACK: FacePackId = 'photos'

export function resolveFacePack(id: string): FacePack {
  return FACE_PACKS[id as FacePackId] ?? FACE_PACKS[DEFAULT_FACE_PACK]
}

export function selectSlot(state: FaceState, rapport: number): FaceSlot {
  if (state === 'thinking') return 'thinking'

  if (state === 'talking') return rapport > 60 ? 'talkingWarm' : 'talkingCold'

  // resting
  if (rapport > 75) return 'restWarm'
  if (rapport > 50) return 'restNeutral'
  if (rapport > 30) return 'restCool'
  return 'restCold'
}
