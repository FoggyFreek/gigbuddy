// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { decodeUploadedText } from '../../../server/utils/decodeText.js'

describe('decodeUploadedText', () => {
  it('decodes UTF-8 (incl. ASCII)', () => {
    expect(decodeUploadedText(Buffer.from('[C]café', 'utf-8'))).toBe('[C]café')
  })

  it('strips a UTF-8 BOM', () => {
    const b = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hi', 'utf-8')])
    expect(decodeUploadedText(b)).toBe('hi')
  })

  it('falls back to Latin-1 when bytes are not valid UTF-8 (older .pro/.cho)', () => {
    // 'é' is a single byte 0xE9 in ISO-8859-1, which is invalid standalone UTF-8.
    expect(decodeUploadedText(Buffer.from('[C]café', 'latin1'))).toBe('[C]café')
  })

  it('decodes UTF-16LE with BOM', () => {
    const b = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('café', 'utf16le')])
    expect(decodeUploadedText(b)).toBe('café')
  })

  it('decodes UTF-16BE with BOM', () => {
    const le = Buffer.from('café', 'utf16le')
    const be = Buffer.alloc(le.length)
    for (let i = 0; i < le.length; i += 2) { be[i] = le[i + 1]; be[i + 1] = le[i] }
    const b = Buffer.concat([Buffer.from([0xfe, 0xff]), be])
    expect(decodeUploadedText(b)).toBe('café')
  })

  it('returns empty string for an empty buffer', () => {
    expect(decodeUploadedText(Buffer.alloc(0))).toBe('')
  })
})
