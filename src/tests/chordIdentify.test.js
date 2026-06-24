import { describe, expect, it } from 'vitest'
import {
  identifyChords,
  absoluteFretsToChordShape,
  formatChordName,
  formatNote,
} from '../utils/chordIdentify.ts'

// Voicings are absolute frets, low->high (EADGBe): -1 mute, 0 open, n fret.
const top = (frets) => identifyChords(frets)[0]?.name

describe('identifyChords — known open voicings', () => {
  it('names a C major chord', () => {
    expect(top([-1, 3, 2, 0, 1, 0])).toBe('C')
  })
  it('names an A minor chord', () => {
    expect(top([-1, 0, 2, 2, 1, 0])).toBe('Am')
  })
  it('names an A minor 7', () => {
    expect(top([-1, 0, 2, 0, 1, 0])).toBe('Am7')
  })
  it('names a dominant E7', () => {
    expect(top([0, 2, 0, 1, 0, 0])).toBe('E7')
  })
  it('names a Dsus4', () => {
    expect(top([-1, -1, 0, 2, 3, 3])).toBe('Dsus4')
  })
  it('names a two-note power chord', () => {
    expect(top([3, 5, 5, -1, -1, -1])).toBe('G5')
  })
})

describe('identifyChords — slash chords and ranking', () => {
  it('names a C major over a G bass as C/G, ranked first with a full match', () => {
    const [best] = identifyChords([3, 3, 2, 0, 1, 0])
    expect(best.name).toBe('C/G')
    expect(best.rootPc).toBe(0)
    expect(best.bassPc).toBe(7)
    expect(best.score).toMatchObject({
      fullMatch: true,
      rootInBass: false,
      unexplainedTones: 0,
      qualityRank: 1,
    })
  })

  it('keeps the root un-slashed when it is the lowest note', () => {
    const [best] = identifyChords([-1, 3, 2, 0, 1, 0])
    expect(best.name).toBe('C')
    expect(best.bassPc).toBeNull()
    expect(best.score.rootInBass).toBe(true)
  })
})

describe('identifyChords — voicing tolerance', () => {
  it('names a seventh chord even when the fifth is omitted (root/3rd/b7)', () => {
    // C, E, Bb — no G. Still a C7.
    expect(top([-1, 3, 2, 3, -1, -1])).toBe('C7')
  })

  it('ignores octave doublings (duplicate notes do not change the result)', () => {
    const c = identifyChords([-1, 3, 2, 0, 1, 0])[0]
    expect(c.name).toBe('C')
    expect(c.notes).toEqual(['C', 'E', 'G']) // 5 strings, 3 distinct notes
  })
})

describe('identifyChords — flat-root spelling', () => {
  it('spells a Bb major with a flat', () => {
    expect(top([-1, 1, 3, 3, 3, 1])).toBe('Bb')
  })
  it('spells an Eb major with a flat', () => {
    expect(top([-1, 6, 8, 8, 8, 6])).toBe('Eb')
  })
  it('spells an Ab major with a flat', () => {
    expect(top([4, 6, 6, 5, 4, 4])).toBe('Ab')
  })
})

describe('identifyChords — cautious on fragments', () => {
  it('returns nothing for a bare major-third dyad', () => {
    expect(identifyChords([-1, 3, 2, -1, -1, -1])).toEqual([])
  })
  it('returns nothing for a single note', () => {
    expect(identifyChords([-1, -1, -1, -1, -1, 0])).toEqual([])
  })
  it('returns nothing when every string is muted', () => {
    expect(identifyChords([-1, -1, -1, -1, -1, -1])).toEqual([])
  })
})

describe('identifyChords — input validation', () => {
  it('throws RangeError when there are not exactly 6 strings', () => {
    expect(() => identifyChords([0, 0, 0])).toThrow(RangeError)
  })
  it('throws RangeError on an out-of-range fret', () => {
    expect(() => identifyChords([0, 0, 0, 0, 0, 25])).toThrow(RangeError)
    expect(() => identifyChords([-2, 0, 0, 0, 0, 0])).toThrow(RangeError)
  })
  it('throws RangeError on a non-integer fret', () => {
    expect(() => identifyChords([0, 0, 0, 0, 0, 1.5])).toThrow(RangeError)
  })
  it('throws RangeError on a malformed tuning', () => {
    expect(() => identifyChords([-1, 3, 2, 0, 1, 0], [40, 45, 50])).toThrow(RangeError)
  })
})

describe('formatters', () => {
  it('spells a chord name with a slash bass', () => {
    expect(formatChordName(0, 'm7', 7)).toBe('Cm7/G')
  })
  it('drops the slash when the bass is the root', () => {
    expect(formatChordName(0, '', 0)).toBe('C')
  })
  it('prefers flats for black-key roots by default', () => {
    expect(formatNote(10)).toBe('Bb')
    expect(formatNote(0)).toBe('C')
  })
})

describe('absoluteFretsToChordShape', () => {
  it('keeps open-position shapes at baseFret 1, preserving open and muted strings', () => {
    expect(absoluteFretsToChordShape([-1, 3, 2, 0, 1, 0])).toEqual({
      baseFret: 1,
      frets: [-1, 3, 2, 0, 1, 0],
    })
  })
  it('normalizes a high-position voicing to a compact baseFret', () => {
    // Eb A-shape barre at fret 6 -> baseFret 6, relative frets.
    expect(absoluteFretsToChordShape([-1, 6, 8, 8, 8, 6])).toEqual({
      baseFret: 6,
      frets: [-1, 1, 3, 3, 3, 1],
    })
  })
})
