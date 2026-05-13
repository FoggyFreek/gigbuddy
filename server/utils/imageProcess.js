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

/**
 * Validates uploaded image content via magic bytes, then re-encodes with sharp.
 * Re-encoding strips EXIF/metadata and confirms the data is a decodable image.
 * Returns { buffer, size, mimetype } ready for storage.
 * Throws with .status = 400 on invalid input.
 */
export async function validateAndReencodeImage(buffer, mimetype) {
  const checkMagic = MAGIC_BYTES[mimetype]
  if (!checkMagic || !checkMagic(buffer)) {
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
    const img = sharp(buffer, {
      failOn: 'warning',
      limitInputPixels: 50_000_000,
    }).rotate()
    if (mimetype === 'image/jpeg') output = await img.jpeg({ quality: 85 }).toBuffer()
    else if (mimetype === 'image/png') output = await img.png().toBuffer()
    else output = await img.webp({ quality: 85 }).toBuffer()
  } catch {
    const err = new Error('Invalid or corrupt image')
    err.status = 400
    throw err
  }

  return { buffer: output, size: output.length, mimetype }
}
