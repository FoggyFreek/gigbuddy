/**
 * Magic-byte verification for non-image document uploads.
 *
 * multer populates req.file.mimetype from the multipart Content-Type header,
 * which is fully client-controlled. This module independently checks the
 * actual byte signature of the uploaded buffer to confirm it matches the
 * declared MIME type, preventing MIME-type spoofing.
 *
 * Each entry maps a MIME type to one or more valid leading byte sequences.
 * A file is accepted if its buffer starts with ANY of the listed signatures.
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
  // OOXML formats are ZIP archives (.xlsx, .docx)
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
    [0x50, 0x4b, 0x03, 0x04], // ZIP local file header (non-empty)
    [0x50, 0x4b, 0x05, 0x06], // ZIP end-of-central-directory (empty archive edge case)
  ],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    [0x50, 0x4b, 0x03, 0x04],
    [0x50, 0x4b, 0x05, 0x06],
  ],
}

function startsWith(buf, bytes) {
  if (buf.length < bytes.length) return false
  return bytes.every((b, i) => buf[i] === b)
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
  const sigs = SIGNATURES[mimetype]
  if (!sigs) return false
  return sigs.some((sig) => startsWith(buffer, sig))
}
