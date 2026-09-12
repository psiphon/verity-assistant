import sharp from 'sharp'
import { readdirSync, mkdirSync, rmSync } from 'fs'
import { extname, basename, join } from 'path'

// Source art: full-bleed square face images, solid background, no
// transparency. This crops each into a circle (alpha outside the circle) so it
// renders as a floating "ball" head. Re-run `npm run circle-crop-faces` after
// adding/replacing any source image.
//
// One entry per face pack. Files whose name starts with "_" (e.g. a contact
// sheet the slices were cut from) are skipped.
const PACKS = [
  { src: 'assets/faces', out: 'src/renderer/src/assets/faces' },
  { src: 'assets/meeseeks', out: 'src/renderer/src/assets/faces-meeseeks' }
]

// Larger than the ~180px the face renders at so it stays crisp on HiDPI
// displays and if the window ever grows.
const OUTPUT_SIZE = 512

const mask = Buffer.from(
  `<svg width="${OUTPUT_SIZE}" height="${OUTPUT_SIZE}"><circle cx="${OUTPUT_SIZE / 2}" cy="${OUTPUT_SIZE / 2}" r="${OUTPUT_SIZE / 2}" fill="#fff"/></svg>`
)

for (const { src, out } of PACKS) {
  const files = readdirSync(src).filter(
    (f) => !f.startsWith('_') && ['.jpg', '.jpeg', '.png'].includes(extname(f).toLowerCase())
  )

  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })

  for (const file of files) {
    const name = basename(file, extname(file))
    await sharp(join(src, file))
      .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: 'cover' })
      .composite([{ input: mask, blend: 'dest-in' }])
      .png()
      .toFile(join(out, `${name}.png`))
  }

  console.log(`Circle-cropped ${files.length} face(s) from ${src} into ${out}`)
}
