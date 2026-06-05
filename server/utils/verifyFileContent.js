/**
 * Magic-byte verification for non-image document uploads.
 *
 * multer populates req.file.mimetype from the multipart Content-Type header,
 * which is fully client-controlled. This module independently checks the
 * actual byte signature of the uploaded buffer to confirm it matches the
 * declared MIME type, preventing MIME-type spoofing.
 *
 * Binary formats with reliable magic bytes are accepted when their leading
 * bytes match. OOXML files are ZIP containers, so they are accepted only when
 * the archive contains the expected Office document entries.
 */

const SIGNATURES = {
  'application/pdf': [
    [0x25, 0x50, 0x44, 0x46], // %PDF
  ],
  // OLE2 Compound Document — used by legacy .xls and .doc
  'application/vnd.ms-excel': [
    [0xd0, 0xcf, 0x11, 0xe0],
  ],
  'application/msword': [
    [0xd0, 0xcf, 0x11, 0xe0],
  ],
}

const OOXML_REQUIRED_ENTRIES = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xl/workbook.xml',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word/document.xml',
}

function startsWith(buf, bytes) {
  if (buf.length < bytes.length) return false
  return bytes.every((b, i) => buf[i] === b)
}

function readZipLocalFileNames(buffer) {
  const names = new Set()
  let offset = 0

  while (offset + 30 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset)
    if (signature !== 0x04034b50) break

    const flags = buffer.readUInt16LE(offset + 6)
    const compressedSize = buffer.readUInt32LE(offset + 18)
    const filenameLength = buffer.readUInt16LE(offset + 26)
    const extraLength = buffer.readUInt16LE(offset + 28)
    const filenameStart = offset + 30
    const filenameEnd = filenameStart + filenameLength
    const dataStart = filenameEnd + extraLength

    if (filenameEnd > buffer.length || dataStart > buffer.length) return names

    names.add(buffer.toString('utf8', filenameStart, filenameEnd).replaceAll('\\', '/'))

    // Bit 3 means sizes are stored in a data descriptor after the payload.
    // Avoid guessing through arbitrary bytes; valid OOXML uploads from normal
    // Office tooling include enough local headers before this is encountered.
    if ((flags & 0x08) !== 0) break

    offset = dataStart + compressedSize
  }

  return names
}

function verifyOoxmlContent(buffer, mimetype) {
  if (!startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])) return false
  const entries = readZipLocalFileNames(buffer)
  return entries.has('[Content_Types].xml') && entries.has(OOXML_REQUIRED_ENTRIES[mimetype])
}

/**
 * Returns true if the buffer's magic bytes match the declared MIME type.
 *
 * text/plain has no reliable universal signature; instead we reject any buffer
 * that contains null bytes, which reliably indicates binary content masquerading
 * as plain text.
 *
 * Returns false for MIME types not in the known set (caller should 400).
 */
export function verifyDocumentContent(buffer, mimetype) {
  if (mimetype === 'text/plain') {
    return !buffer.includes(0x00)
  }
  if (mimetype in OOXML_REQUIRED_ENTRIES) {
    return verifyOoxmlContent(buffer, mimetype)
  }
  const sigs = SIGNATURES[mimetype]
  if (!sigs) return false
  return sigs.some((sig) => startsWith(buffer, sig))
}

/**
 * Returns true if the buffer looks like an MP3.
 *
 * MP3 has no single universal magic number. Two reliable leading patterns cover
 * real-world files: an ID3v2 metadata tag ("ID3"), or a raw MPEG audio frame
 * whose 11-bit frame sync is all ones (0xFF followed by 0b111x_xxxx). Anything
 * else (e.g. a renamed wav/m4a/ogg) is rejected.
 */
export function verifyAudioContent(buffer) {
  if (buffer.length < 2) return false
  // ID3v2 tag: 'I' 'D' '3'
  if (startsWith(buffer, [0x49, 0x44, 0x33])) return true
  // MPEG audio frame sync: 0xFF then top 3 bits of next byte set.
  return buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0
}
