// Decode an uploaded text file to a JS string, honoring the encodings ChordPro
// permits (ASCII, ISO-8859-1, UTF-8/16/32) rather than assuming UTF-8. A naive
// buffer.toString('utf-8') corrupts Latin-1 files with accented characters and
// any UTF-16/32 file. Strategy: detect a BOM first; otherwise try strict UTF-8
// and fall back to Latin-1 (every byte is valid Latin-1, so it never throws).
// Node's TextDecoder doesn't support UTF-32 (it's not in the WHATWG encoding
// list), so decode those rare files by hand from the 4-byte code points.
function decodeUtf32(bytes, littleEndian) {
  let out = ''
  for (let i = 0; i + 3 < bytes.length; i += 4) {
    const cp = littleEndian
      ? (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) >>> 0
      : ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0
    out += cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? '\uFFFD' : String.fromCodePoint(cp)
  }
  return out
}

export function decodeUploadedText(buffer) {
  if (!buffer || buffer.length === 0) return ''

  const b = buffer
  // BOM sniffing (order matters: check 4-byte UTF-32 before 2-byte UTF-16).
  if (b.length >= 4 && b[0] === 0x00 && b[1] === 0x00 && b[2] === 0xfe && b[3] === 0xff) {
    return decodeUtf32(b.subarray(4), false)
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xfe && b[2] === 0x00 && b[3] === 0x00) {
    return decodeUtf32(b.subarray(4), true)
  }
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(b.subarray(2))
  }
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(b.subarray(2))
  }
  // No BOM: prefer UTF-8 (covers ASCII), but fall back to Latin-1 when the bytes
  // aren't valid UTF-8 (an older ISO-8859-1 .cho/.pro). TextDecoder('utf-8') also
  // strips a UTF-8 BOM if present.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b)
  } catch {
    return new TextDecoder('latin1').decode(b)
  }
}
