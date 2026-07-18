import sharp from 'sharp'

// Magic-byte signatures for each supported MIME type
const MAGIC_BYTES = {
  'image/jpeg': (buf) => buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  'image/png': (buf) =>
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a,
  // RIFF....WEBP
  'image/webp': (buf) =>
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50,
}

const IMAGE_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}

export const IMAGE_PROCESSING_PRESETS = Object.freeze({
  logo: Object.freeze({ maxDimension: 800, quality: 90 }),
  avatar: Object.freeze({ maxDimension: 720, quality: 85 }),
  profileBanner: Object.freeze({ maxDimension: 820, quality: 85 }),
  banner: Object.freeze({ maxDimension: 1600, quality: 82 }),
  memory: Object.freeze({ maxDimension: 1600, quality: 82 }),
  sharePhoto: Object.freeze({ maxDimension: 1200, quality: 82 }),
  invoiceLogo: Object.freeze({ maxDimension: 800, quality: 90 }),
  purchaseReceipt: Object.freeze({ maxDimension: 2000, quality: 85 }),
  songCover: Object.freeze({ maxDimension: 320, quality: 82, square: true, format: 'webp' }),
})

// Object-key extension for a validated/re-encoded image. Derive it from the
// output MIME type (authoritative) rather than the original filename, which may
// be missing, wrong, or in a different format than what we actually stored.
export function extensionForImageMime(mimetype) {
  return IMAGE_EXTENSIONS[mimetype] || '.jpg'
}

/**
 * Validates uploaded image content via magic bytes, then re-encodes with sharp.
 * Re-encoding strips EXIF/metadata and confirms the data is a decodable image.
 * An optional asset preset caps dimensions and selects lossy-image quality.
 * `square: true` center-crops to a maxDimension × maxDimension square (inputs
 * already smaller than the target keep their original size — display code
 * square-crops those via CSS). `format: 'webp'` forces WebP output regardless
 * of the input type; the returned mimetype reflects what was actually encoded.
 * Returns { buffer, size, mimetype } ready for storage.
 * Throws with .status = 400 on invalid input.
 */
export async function validateAndReencodeImage(buffer, mimetype, options = {}) {
  const checkMagic = MAGIC_BYTES[mimetype]
  if (!checkMagic?.(buffer)) {
    const err = new Error('File content does not match declared type')
    err.status = 400
    throw err
  }

  let output
  try {
    // failOn 'warning' is sharp's strictest mode (the default).
    // limitInputPixels caps decoded pixel count to block decompression-bomb DoS;
    // sharp's default of ~268MP is far higher than any band photo needs.
    // .rotate() with no args bakes EXIF orientation into pixels before the
    // re-encode strips metadata, so portrait phone photos stay upright.
    let img = sharp(buffer, {
      failOn: 'warning',
      limitInputPixels: 50_000_000,
    }).rotate()

    if (options.maxDimension) {
      img = img.resize({
        width: options.maxDimension,
        height: options.maxDimension,
        fit: options.square ? 'cover' : 'inside',
        withoutEnlargement: true,
      })
    }

    const quality = options.quality ?? 85
    const outputMime = options.format === 'webp' ? 'image/webp' : mimetype
    if (outputMime === 'image/jpeg') {
      output = await img.jpeg({ quality, mozjpeg: true }).toBuffer()
    } else if (outputMime === 'image/png') {
      output = await img.png({ compressionLevel: 9, effort: 10 }).toBuffer()
    } else {
      output = await img.webp({ quality, effort: 6 }).toBuffer()
    }
    return { buffer: output, size: output.length, mimetype: outputMime }
  } catch {
    const err = new Error('Invalid or corrupt image')
    err.status = 400
    throw err
  }
}
