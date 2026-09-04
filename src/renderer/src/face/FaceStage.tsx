import { useEffect, useRef } from 'react'
import 'pixi.js/unsafe-eval'
import { Application, Assets, Sprite, Texture } from 'pixi.js'
import type { FaceState } from './faceAtlas'
import { selectFace, SPRITE_URL } from './faceAtlas'

interface FaceStageProps {
  state: FaceState
  rapport: number
  onClick?: () => void
}

export function FaceStage({ state, rapport, onClick }: FaceStageProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const spritesRef = useRef<Record<string, Sprite> | null>(null)
  const stateRef = useRef(state)
  const rapportRef = useRef(rapport)

  useEffect(() => {
    stateRef.current = state
    rapportRef.current = rapport
  }, [state, rapport])

  useEffect(() => {
    const containerEl = containerRef.current
    if (!containerEl) return
    const container: HTMLDivElement = containerEl

    let disposed = false
    const app = new Application()

    async function setup(): Promise<void> {
      await app.init({
        backgroundAlpha: 0,
        antialias: true,
        resizeTo: container,
        autoDensity: true,
        resolution: Math.max(window.devicePixelRatio || 1, 1)
      })
      if (disposed) {
        app.destroy(true, { children: true })
        return
      }
      container.appendChild(app.canvas)

      const entries = Object.entries(SPRITE_URL)
      const loaded = await Assets.load<Texture>(entries.map(([, url]) => url))

      // One sprite per face, all added once and left in the stage - the
      // active one is switched by toggling `.visible` rather than
      // reassigning `.texture` on a live sprite.
      const sprites: Record<string, Sprite> = {}
      for (const [name, url] of entries) {
        const tex = loaded[url]
        tex.source.scaleMode = 'nearest'
        const sprite = new Sprite(tex)
        sprite.anchor.set(0.5)
        sprite.visible = name === selectFace(stateRef.current, rapportRef.current)
        app.stage.addChild(sprite)
        sprites[name] = sprite
      }
      spritesRef.current = sprites

      layout()

      let elapsed = 0
      app.ticker.add((ticker) => {
        elapsed += ticker.deltaTime / 60
        layout(elapsed)
      })

      function layout(t = 0): void {
        const w = app.renderer.width / app.renderer.resolution
        const h = app.renderer.height / app.renderer.resolution
        const bob = Math.sin(t * 1.6) * 4
        const speakingWobble = stateRef.current === 'talking' ? Math.sin(t * 14) * 0.03 : 0
        const fill = Math.min(w, h) * 0.9
        for (const sprite of Object.values(sprites)) {
          // Scale relative to this sprite's own native size (not a fixed
          // divisor) so it fills the container regardless of the source
          // image's resolution or the container's own size.
          const nativeSize = Math.max(sprite.texture.orig.width, sprite.texture.orig.height)
          const scale = (fill / nativeSize) * (1 + speakingWobble)
          sprite.x = w / 2
          sprite.y = h / 2 + bob
          sprite.scale.set(scale)
        }
      }
    }

    setup()

    return () => {
      disposed = true
      spritesRef.current = null
      try {
        app.destroy(true, { children: true })
      } catch {
        // app was never fully initialized
      }
    }
  }, [])

  useEffect(() => {
    const sprites = spritesRef.current
    if (!sprites) return
    const activeName = selectFace(state, rapport)
    for (const [name, sprite] of Object.entries(sprites)) {
      sprite.visible = name === activeName
    }
  }, [state, rapport])

  // The face is both the window's drag handle and its click target. CSS
  // -webkit-app-region: drag can't do both reliably on Windows - once a
  // mousedown starts a native window drag, the click event never fires, even
  // for a press-and-release with no movement. Dragging the window manually
  // (mouse deltas -> setPosition) instead keeps click detection fully in our
  // own hands.
  const dragRef = useRef<{
    pointerId: number
    startScreenX: number
    startScreenY: number
    startWinX: number
    startWinY: number
    moved: boolean
  } | null>(null)

  return (
    <div
      ref={containerRef}
      className="face-stage"
      onPointerDown={(e) => {
        const [winX, winY] = window.verity.window.getPosition()
        dragRef.current = {
          pointerId: e.pointerId,
          startScreenX: e.screenX,
          startScreenY: e.screenY,
          startWinX: winX,
          startWinY: winY,
          moved: false
        }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== e.pointerId) return
        const dx = e.screenX - drag.startScreenX
        const dy = e.screenY - drag.startScreenY
        if (!drag.moved && Math.hypot(dx, dy) < 4) return
        drag.moved = true
        window.verity.window.setPosition(drag.startWinX + dx, drag.startWinY + dy)
      }}
      onPointerUp={(e) => {
        const drag = dragRef.current
        dragRef.current = null
        if (!drag || drag.pointerId !== e.pointerId) return
        e.currentTarget.releasePointerCapture(e.pointerId)
        if (!drag.moved) onClick?.()
      }}
    />
  )
}
