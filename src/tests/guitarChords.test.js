import { describe, expect, it } from 'vitest'
import { lookupGuitarChord } from '../utils/guitarChords.ts'

describe('lookupGuitarChord', () => {
  it('resolves a common open chord to its fretboard shape', () => {
    const c = lookupGuitarChord('C')
    expect(c).not.toBeNull()
    expect(c.baseFret).toBe(1)
    expect(c.frets).toHaveLength(6)
  })

  it('returns null for an unknown chord', () => {
    expect(lookupGuitarChord('Xyz')).toBeNull()
  })

  it('returns null for blank, whitespace, or nullish input', () => {
    expect(lookupGuitarChord('')).toBeNull()
    expect(lookupGuitarChord('   ')).toBeNull()
    expect(lookupGuitarChord(null)).toBeNull()
    expect(lookupGuitarChord(undefined)).toBeNull()
  })

  it('falls back to the part before a slash bass note', () => {
    // "Am7/G" has no exact entry, so it resolves to the "Am7" shape.
    expect(lookupGuitarChord('Am7/G')).toBe(lookupGuitarChord('Am7'))
  })

  it('folds Unicode accidentals to ASCII (♯ → #, ♭ → b)', () => {
    expect(lookupGuitarChord('C♯')).toBe(lookupGuitarChord('C#'))
    expect(lookupGuitarChord('B♭')).toBe(lookupGuitarChord('Bb'))
  })

  it('resolves enharmonic flat-root aliases (Cb → B)', () => {
    expect(lookupGuitarChord('Cb')).toBe(lookupGuitarChord('B'))
  })

  it('treats sus and sus4 as aliases', () => {
    expect(lookupGuitarChord('Asus')).toBe(lookupGuitarChord('Asus4'))
  })

  it('trims surrounding whitespace before lookup', () => {
    expect(lookupGuitarChord('  G  ')).toBe(lookupGuitarChord('G'))
  })
})
