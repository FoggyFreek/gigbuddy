import { describe, expect, it } from 'vitest'
import { formatDuration, parseDuration } from '../utils/formatDuration.js'

describe('formatDuration', () => {
  it('formats seconds as mm:ss', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(5)).toBe('0:05')
    expect(formatDuration(238)).toBe('3:58')
    expect(formatDuration(600)).toBe('10:00')
  })

  it('formats past an hour as h:mm:ss', () => {
    expect(formatDuration(3661)).toBe('1:01:01')
    expect(formatDuration(7200)).toBe('2:00:00')
  })

  it('returns empty string for null/blank/invalid', () => {
    expect(formatDuration(null)).toBe('')
    expect(formatDuration(undefined)).toBe('')
    expect(formatDuration('')).toBe('')
  })
})

describe('parseDuration', () => {
  it('parses mm:ss and h:mm:ss', () => {
    expect(parseDuration('3:58')).toBe(238)
    expect(parseDuration('1:01:01')).toBe(3661)
    expect(parseDuration('0:05')).toBe(5)
  })

  it('parses plain seconds', () => {
    expect(parseDuration('238')).toBe(238)
  })

  it('returns null for blank or unparseable input', () => {
    expect(parseDuration('')).toBeNull()
    expect(parseDuration('abc')).toBeNull()
    expect(parseDuration('1:xx')).toBeNull()
  })
})
