import sharp from 'sharp'
import { readdirSync, mkdirSync } from 'fs'
import { extname, basename, join } from 'path'

// Source art: full-bleed square face images (assets/faces/*.{jpg,png}), solid
// yellow background, no transparency. This crops each into a circle (alpha
// outside the circle) so it renders as a floating "ball" head. Re-run
// `npm run circle-crop-faces` after adding/replacing images in assets/faces.

const SRC_DIR = 'assets/faces'
const OUT_DIR = 'src/renderer/src/assets/faces'
const OUTPUT_SIZE = 360

mkdirSync(OUT_DIR, { recursive: true })

const files = readdirSync(SRC_DIR).filter((f) =>
  ['.jpg', '.jpeg', '.png'].includes(extname(f).toLowerCase())
)

const mask = Buffer.from(
  `<svg width="${OUTPUT_SIZE}" height="${OUTPUT_SIZE}"><circle cx="${OUTPUT_SIZE / 2}" cy="${OUTPUT_SIZE / 2}" r="${OUTPUT_SIZE / 2}" fill="#fff"/></svg>`
)

for (const file of files) {
  const name = basename(file, extname(file))
  await sharp(join(SRC_DIR, file))
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: 'cover' })
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toFile(join(OUT_DIR, `${name}.png`))
}

console.log(`Circle-cropped ${files.length} face(s) into ${OUT_DIR}`)
