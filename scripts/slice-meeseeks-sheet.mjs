import sharp from 'sharp'
import { mkdirSync } from 'fs'
import { join } from 'path'

// One-off: carve the 12 Meeseeks expressions out of the 630x630 contact sheet
// (assets/meeseeks/_source-sheet.jpg) into equal squares, one per mood.
//
// The sheet is a low-res JPEG and not a clean grid - rows have uneven pitch and
// the little hair tufts float between faces - so the face centres below are
// hand-tuned to this specific image. Two clean-ups make the carved faces hold
// up when the app scales them: near-background pixels are snapped to the exact
// backdrop colour (kills the JPEG "mosquito noise" halo around the linework),
// then each face is resized up with a smooth filter.
//
// Re-run with `npm run slice-meeseeks` if the source changes, then
// `npm run circle-crop-faces` to regenerate the renderer assets.

const SRC = 'assets/meeseeks/_source-sheet.jpg'
const OUT_DIR = 'assets/meeseeks'
const CROP = 170 // native carve size on the source sheet
const OUTPUT_SIZE = 340 // upscaled asset size
const BG_SNAP_DIST = 42 // pixels within this of the backdrop colour are flattened

// column centre (x, shared by every row) and per-column row centres (y)
const CX = [190, 321, 444]
const CY = [
  [110, 260, 388, 515],
  [120, 264, 375, 500],
  [128, 264, 380, 522]
]

// row-major expression names, laid out to match CX / CY (column then row)
const NAMES = [
  ['manic', 'nervous', 'angry', 'frustrated'],
  ['glum', 'pained', 'happy', 'alarmed'],
  ['menacing', 'content', 'surprised', 'distraught']
]

mkdirSync(OUT_DIR, { recursive: true })

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const { width: W, height: H, channels: chn } = info
const bg = [data[0], data[1], data[2]]

// One pass over the sheet: flatten the backdrop (any pixel close to the corner
// colour becomes exactly that colour, so upscaling doesn't magnify JPEG noise
// in the flat areas) and record which pixels are linework, for the recentring
// pass below.
const cleaned = Buffer.from(data)
const ink = new Uint8Array(W * H)
const snapSq = BG_SNAP_DIST * BG_SNAP_DIST
for (let p = 0; p < W * H; p++) {
  const i = p * chn
  const dr = cleaned[i] - bg[0]
  const dg = cleaned[i + 1] - bg[1]
  const db = cleaned[i + 2] - bg[2]
  const distSq = dr * dr + dg * dg + db * db
  if (distSq <= snapSq) {
    cleaned[i] = bg[0]
    cleaned[i + 1] = bg[1]
    cleaned[i + 2] = bg[2]
  }
  if (distSq > 1600) ink[p] = 1
}

const source = sharp(cleaned, { raw: { width: W, height: H, channels: chn } })

let n = 0
for (let c = 0; c < 3; c++) {
  for (let r = 0; r < 4; r++) {
    const gx = CX[c]
    const gy = CY[c][r]
    // small horizontal recentre on the ink mass around the eyes
    let sx = 0
    let count = 0
    for (let y = Math.max(0, gy - 30); y <= Math.min(H - 1, gy + 10); y++) {
      for (let x = Math.max(0, gx - 40); x <= Math.min(W - 1, gx + 40); x++) {
        if (ink[y * W + x] === 1) {
          sx += x
          count++
        }
      }
    }
    const cx = count ? Math.round(gx * 0.6 + (sx / count) * 0.4) : gx
    const left = Math.min(Math.max(0, Math.round(cx - CROP / 2)), W - CROP)
    const top = Math.min(Math.max(0, Math.round(gy - CROP / 2)), H - CROP)

    await source
      .clone()
      .extract({ left, top, width: CROP, height: CROP })
      .resize(OUTPUT_SIZE, OUTPUT_SIZE, { kernel: 'lanczos3' })
      .sharpen({ sigma: 0.6 })
      .png()
      .toFile(join(OUT_DIR, `${NAMES[c][r]}.png`))
    n++
  }
}

console.log(`Sliced ${n} faces into ${OUT_DIR} at ${OUTPUT_SIZE}px`)
