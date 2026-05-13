// @vitest-environment node
import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { validateAndReencodeImage } from '../../../server/utils/imageProcess.js'

// Helpers — synthesize real images on the fly so the test has no fixture deps
function solid({ width = 8, height = 8, channels = 3, r = 255, g = 0, b = 0 } = {}) {
  return sharp({ create: { width, height, channels, background: { r, g, b } } })
}

async function makePng(opts) { return solid(opts).png().toBuffer() }
async function makeJpeg(opts) { return solid(opts).jpeg().toBuffer() }
async function makeWebp(opts) { return solid(opts).webp().toBuffer() }

describe('validateAndReencodeImage — happy path', () => {
  it('round-trips a real PNG', async () => {
    const buf = await makePng()
    const out = await validateAndReencodeImage(buf, 'image/png')
    expect(out.mimetype).toBe('image/png')
    expect(out.size).toBeGreaterThan(0)
    expect(out.size).toBe(out.buffer.length)
    const meta = await sharp(out.buffer).metadata()
    expect(meta.format).toBe('png')
  })

  it('round-trips a real JPEG', async () => {
    const buf = await makeJpeg()
    const out = await validateAndReencodeImage(buf, 'image/jpeg')
    expect(out.mimetype).toBe('image/jpeg')
    const meta = await sharp(out.buffer).metadata()
    expect(meta.format).toBe('jpeg')
  })

  it('round-trips a real WebP', async () => {
    const buf = await makeWebp()
    const out = await validateAndReencodeImage(buf, 'image/webp')
    expect(out.mimetype).toBe('image/webp')
    const meta = await sharp(out.buffer).metadata()
    expect(meta.format).toBe('webp')
  })
})

describe('validateAndReencodeImage — magic-byte rejection', () => {
  it('rejects JPEG bytes when MIME claims PNG', async () => {
    const jpeg = await makeJpeg()
    await expect(validateAndReencodeImage(jpeg, 'image/png')).rejects.toMatchObject({
      status: 400,
      message: /does not match declared type/,
    })
  })

  it('rejects PNG bytes when MIME claims JPEG', async () => {
    const png = await makePng()
    await expect(validateAndReencodeImage(png, 'image/jpeg')).rejects.toMatchObject({
      status: 400,
      message: /does not match declared type/,
    })
  })

  it('rejects WebP bytes when MIME claims JPEG', async () => {
    const webp = await makeWebp()
    await expect(validateAndReencodeImage(webp, 'image/jpeg')).rejects.toMatchObject({
      status: 400,
    })
  })

  it('rejects an empty buffer', async () => {
    await expect(validateAndReencodeImage(Buffer.alloc(0), 'image/png')).rejects.toMatchObject({
      status: 400,
    })
  })

  it('rejects an unsupported MIME type even with valid bytes for it', async () => {
    // GIF magic bytes "GIF89a"
    const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...new Array(20).fill(0)])
    await expect(validateAndReencodeImage(gif, 'image/gif')).rejects.toMatchObject({
      status: 400,
    })
  })
})

describe('validateAndReencodeImage — sharp decode rejection', () => {
  it('rejects garbage payload that has a valid PNG header', async () => {
    const fakePng = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(512, 0xab),
    ])
    await expect(validateAndReencodeImage(fakePng, 'image/png')).rejects.toMatchObject({
      status: 400,
      message: /Invalid or corrupt image/,
    })
  })

  it('rejects a truncated JPEG', async () => {
    const jpeg = await makeJpeg({ width: 64, height: 64 })
    const truncated = jpeg.subarray(0, Math.floor(jpeg.length / 2))
    await expect(validateAndReencodeImage(truncated, 'image/jpeg')).rejects.toMatchObject({
      status: 400,
    })
  })
})

describe('validateAndReencodeImage — decompression-bomb cap', () => {
  it('rejects an image exceeding the 50 MP pixel limit', async () => {
    // 8000 x 8000 = 64 MP, decodes to ~192 MB raw RGB; on-disk PNG is ~200 KB
    const bomb = await makePng({ width: 8000, height: 8000 })
    await expect(validateAndReencodeImage(bomb, 'image/png')).rejects.toMatchObject({
      status: 400,
      message: /Invalid or corrupt image/,
    })
  }, 20_000)

  it('accepts an image just under the limit (25 MP)', async () => {
    const big = await makePng({ width: 5000, height: 5000 })
    const out = await validateAndReencodeImage(big, 'image/png')
    expect(out.size).toBeGreaterThan(0)
  }, 20_000)
})

describe('validateAndReencodeImage — metadata handling', () => {
  it('strips EXIF metadata from output', async () => {
    // JPEG with embedded EXIF. withExif requires plain-string IFD0 entries.
    const withExif = await sharp({
      create: { width: 16, height: 16, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .withExif({ IFD0: { Copyright: 'gigbuddy-test', Artist: 'should-be-stripped' } })
      .jpeg()
      .toBuffer()

    // sanity: the input really has EXIF
    const inMeta = await sharp(withExif).metadata()
    expect(inMeta.exif).toBeDefined()

    const out = await validateAndReencodeImage(withExif, 'image/jpeg')
    const outMeta = await sharp(out.buffer).metadata()
    expect(outMeta.exif).toBeUndefined()
  })

  it('honors EXIF orientation by baking rotation into pixels', async () => {
    // Build a 100x50 landscape JPEG tagged orientation=6 (rotate 90° CW).
    // After validation+re-encode the dimensions should swap to 50x100.
    const tagged = await sharp({
      create: { width: 100, height: 50, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer()

    const inMeta = await sharp(tagged).metadata()
    expect(inMeta.width).toBe(100)
    expect(inMeta.height).toBe(50)
    expect(inMeta.orientation).toBe(6)

    const out = await validateAndReencodeImage(tagged, 'image/jpeg')
    const outMeta = await sharp(out.buffer).metadata()
    // pixels physically rotated; orientation tag dropped along with other EXIF
    expect(outMeta.width).toBe(50)
    expect(outMeta.height).toBe(100)
    expect(outMeta.orientation).toBeUndefined()
  })
})
