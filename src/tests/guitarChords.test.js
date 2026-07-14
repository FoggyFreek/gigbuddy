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

  it('re-voices a slash bass into the lowest string, per common voicings', () => {
    // The bass note becomes the lowest sounding string; the base shape's upper
    // strings are kept and anything below the bass is muted.
    expect(lookupGuitarChord('Dm/F')).toEqual({ baseFret: 1, frets: [1, -1, 0, 2, 3, 1] })
    expect(lookupGuitarChord('C/G')).toEqual({ baseFret: 1, frets: [3, 3, 2, 0, 1, 0] })
    expect(lookupGuitarChord('C/E')).toEqual({ baseFret: 1, frets: [0, 3, 2, 0, 1, 0] })
    expect(lookupGuitarChord('C/B')).toEqual({ baseFret: 1, frets: [-1, 2, 2, 0, 1, 0] })
    expect(lookupGuitarChord('G/B')).toEqual({ baseFret: 1, frets: [-1, 2, 0, 0, 0, 3] })
    expect(lookupGuitarChord('G/F#')).toEqual({ baseFret: 1, frets: [2, 2, 0, 0, 0, 3] })
    expect(lookupGuitarChord('D/F#')).toEqual({ baseFret: 1, frets: [2, -1, 0, 2, 3, 2] })
    expect(lookupGuitarChord('A/C#')).toEqual({ baseFret: 1, frets: [-1, 4, 2, 2, 2, 0] })
    expect(lookupGuitarChord('F/A')).toEqual({ baseFret: 1, frets: [-1, 0, 3, 2, 1, 1] })
    expect(lookupGuitarChord('Bb/D')).toEqual({ baseFret: 1, frets: [-1, -1, 0, 3, 3, 1] })
  })

  it('picks the enharmonic bass shape regardless of accidental spelling', () => {
    // Db in the bass is the same pitch class as C# → same low-string placement.
    expect(lookupGuitarChord('A/Db')).toEqual(lookupGuitarChord('A/C#'))
    // Unicode accidentals fold to ASCII before the bass is resolved.
    expect(lookupGuitarChord('D/F♯')).toEqual(lookupGuitarChord('D/F#'))
  })

  it('leaves the base shape untouched when the slash part is not a note', () => {
    // "C6/9" is a chord extension, not a slash bass — resolve to the C6 shape.
    expect(lookupGuitarChord('C6/9')).toBe(lookupGuitarChord('C6'))
  })

  it('returns null for a slash chord whose base shape is unknown', () => {
    expect(lookupGuitarChord('Xyz/G')).toBeNull()
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

  it('accepts lowercase chord roots', () => {
    expect(lookupGuitarChord('cadd9')).toBe(lookupGuitarChord('Cadd9'))
    expect(lookupGuitarChord('g')).toBe(lookupGuitarChord('G'))
    expect(lookupGuitarChord('d')).toBe(lookupGuitarChord('D'))
    expect(lookupGuitarChord('em')).toBe(lookupGuitarChord('Em'))
  })
})
