import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FACE_PACKS } from './faceAtlas'
import type { FaceSlot, FaceState } from './faceAtlas'
import type { FacePackId } from '@shared/types'

vi.mock('pixi.js/unsafe-eval', () => ({}))

const PHOTO_SLOTS = FACE_PACKS.photos.slots
const SLOT_COUNT = Object.keys(PHOTO_SLOTS).length

class FakeSprite {
  static instances: FakeSprite[] = []
  anchor = { set: vi.fn() }
  visible = false
  scale = { set: vi.fn() }
  x = 0
  y = 0
  constructor(
    public texture: { __url: string; source: unknown; orig: { width: number; height: number } }
  ) {
    FakeSprite.instances.push(this)
  }
}
class FakeApplication {
  static instances: FakeApplication[] = []
  canvas = document.createElement('canvas')
  stage = { addChild: vi.fn() }
  renderer = { width: 300, height: 200, resolution: 1 }
  ticker = { add: vi.fn() }
  destroy = vi.fn()
  init = vi.fn(async () => {})
  constructor() {
    FakeApplication.instances.push(this)
  }
}
const Assets = {
  load: vi.fn(async (urls: string[]) => {
    const map: Record<string, unknown> = {}
    for (const url of urls) map[url] = { __url: url, source: {}, orig: { width: 100, height: 100 } }
    return map
  })
}
class FakeTexture {}

vi.mock('pixi.js', () => ({
  Application: FakeApplication,
  Assets,
  Sprite: FakeSprite,
  Texture: FakeTexture
}))

// jsdom has no ResizeObserver either, which Pixi's resizeTo option needs -
// a minimal stub is enough since layout math itself isn't under test here.
class FakeResizeObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}
vi.stubGlobal('ResizeObserver', FakeResizeObserver)

// jsdom doesn't implement the Pointer Capture APIs the drag handling relies on.
beforeEach(() => {
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
})

afterEach(() => {
  FakeSprite.instances = []
  FakeApplication.instances = []
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  // @ts-expect-error test-only cleanup of the global the component reads
  delete window.verity
})

function fakeWindowVerity(position: [number, number] = [10, 20]): {
  getPosition: ReturnType<typeof vi.fn>
  setPosition: ReturnType<typeof vi.fn>
} {
  const getPosition = vi.fn(() => position)
  const setPosition = vi.fn()
  window.verity = {
    window: { getPosition, setPosition } as unknown as Window['verity']['window']
  } as Window['verity']
  return { getPosition, setPosition }
}

function spriteForSlot(slot: FaceSlot, pack: FacePackId = 'photos'): FakeSprite | undefined {
  const url = FACE_PACKS[pack].slots[slot]
  return FakeSprite.instances.find((s) => s.texture.__url === url)
}

async function renderFace(
  state: FaceState,
  rapport: number,
  onClick = vi.fn(),
  pack: FacePackId = 'photos'
): Promise<void> {
  const { FaceStage } = await import('./FaceStage')
  render(<FaceStage state={state} rapport={rapport} pack={pack} onClick={onClick} />)
  await waitFor(() => expect(FakeSprite.instances.length).toBe(SLOT_COUNT))
}

describe('FaceStage', () => {
  it('creates one sprite per slot and shows only the one selectSlot picks', async () => {
    fakeWindowVerity()
    await renderFace('thinking', 100)

    expect(spriteForSlot('thinking')?.visible).toBe(true)
    expect(spriteForSlot('talkingWarm')?.visible).toBe(false)
    expect(spriteForSlot('restWarm')?.visible).toBe(false)
  })

  it('shows the correct resting slot for a low rapport score', async () => {
    fakeWindowVerity()
    await renderFace('resting', 10)
    expect(spriteForSlot('restCold')?.visible).toBe(true)
    expect(spriteForSlot('restWarm')?.visible).toBe(false)
  })

  it('loads the images for the requested face pack', async () => {
    fakeWindowVerity()
    await renderFace('resting', 100, vi.fn(), 'meeseeks')
    expect(spriteForSlot('restWarm', 'meeseeks')?.visible).toBe(true)
    expect(
      FakeSprite.instances.every((s) =>
        Object.values(FACE_PACKS.meeseeks.slots).includes(s.texture.__url)
      )
    ).toBe(true)
  })

  it('updates visibility reactively when state/rapport props change', async () => {
    fakeWindowVerity()
    const { FaceStage } = await import('./FaceStage')
    const { rerender } = render(<FaceStage state="resting" rapport={100} pack="photos" />)
    await waitFor(() => expect(FakeSprite.instances.length).toBe(SLOT_COUNT))
    expect(spriteForSlot('restWarm')?.visible).toBe(true)

    rerender(<FaceStage state="talking" rapport={100} pack="photos" />)
    expect(spriteForSlot('restWarm')?.visible).toBe(false)
    expect(spriteForSlot('talkingWarm')?.visible).toBe(true)
  })

  it('treats a press-and-release with no movement as a click', async () => {
    fakeWindowVerity()
    const onClick = vi.fn()
    await renderFace('resting', 100, onClick)

    const stage = document.querySelector('.face-stage')!
    stage.dispatchEvent(
      new PointerEvent('pointerdown', { pointerId: 1, screenX: 100, screenY: 100, bubbles: true })
    )
    stage.dispatchEvent(
      new PointerEvent('pointerup', { pointerId: 1, screenX: 100, screenY: 100, bubbles: true })
    )

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('drags the window instead of clicking once movement passes the threshold', async () => {
    const { setPosition } = fakeWindowVerity([10, 20])
    const onClick = vi.fn()
    await renderFace('resting', 100, onClick)

    const stage = document.querySelector('.face-stage')!
    stage.dispatchEvent(
      new PointerEvent('pointerdown', { pointerId: 1, screenX: 100, screenY: 100, bubbles: true })
    )
    stage.dispatchEvent(
      new PointerEvent('pointermove', { pointerId: 1, screenX: 130, screenY: 100, bubbles: true })
    )
    stage.dispatchEvent(
      new PointerEvent('pointerup', { pointerId: 1, screenX: 130, screenY: 100, bubbles: true })
    )

    expect(setPosition).toHaveBeenCalledWith(40, 20)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('ignores tiny movement under the 4px threshold and still counts it as a click', async () => {
    const { setPosition } = fakeWindowVerity([10, 20])
    const onClick = vi.fn()
    await renderFace('resting', 100, onClick)

    const stage = document.querySelector('.face-stage')!
    stage.dispatchEvent(
      new PointerEvent('pointerdown', { pointerId: 1, screenX: 100, screenY: 100, bubbles: true })
    )
    stage.dispatchEvent(
      new PointerEvent('pointermove', { pointerId: 1, screenX: 102, screenY: 100, bubbles: true })
    )
    stage.dispatchEvent(
      new PointerEvent('pointerup', { pointerId: 1, screenX: 102, screenY: 100, bubbles: true })
    )

    expect(setPosition).not.toHaveBeenCalled()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('destroys the Pixi application on unmount', async () => {
    fakeWindowVerity()
    const { FaceStage } = await import('./FaceStage')
    const { unmount } = render(<FaceStage state="resting" rapport={100} pack="photos" />)
    await waitFor(() => expect(FakeSprite.instances.length).toBe(SLOT_COUNT))

    unmount()
    expect(FakeApplication.instances[0].destroy).toHaveBeenCalled()
  })
})
