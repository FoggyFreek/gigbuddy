import { describe, expect, it } from 'vitest'
import {
  identifyChords,
  absoluteFretsToChordShape,
  formatChordName,
  formatNote,
  STANDARD_TUNING,
} from '../utils/chordIdentify.ts'

// Voicings are absolute frets, low->high (EADGBe): -1 mute, 0 open, n fret.
const top = (frets) => identifyChords(frets)[0]?.name

// Build a 6-string voicing (absolute frets, low->high) that sounds the given
// pitch classes in ascending pitch, lowest pc first = bass. Lets a test name a
// chord by its notes without hand-working the fretboard. Each pc lands on the
// next string at the lowest fret that keeps the pitch climbing, so pcs[0] is the
// bass and there are no octave/voicing surprises.
function voice(pcsLowToHigh) {
  const frets = [-1, -1, -1, -1, -1, -1]
  let prevMidi = -1
  pcsLowToHigh.forEach((pc, i) => {
    const open = STANDARD_TUNING[i]
    let fret = (((pc - open) % 12) + 12) % 12
    while (open + fret <= prevMidi) fret += 12
    if (fret > 24) throw new Error(`voice: fret ${fret} out of range for pc ${pc}`)
    frets[i] = fret
    prevMidi = open + fret
  })
  return frets
}

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
      qualityRank: 0, // a plain major triad is the simplest quality
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

describe('identifyChords — 4- and 5-note chords (stacked-thirds decomposition)', () => {
  // C-rooted, bass = C (pcs[0] = 0). Pitch classes relative to C:
  // C0 Db1 D2 Eb3 E4 F5 Gb6 G7 Ab8 A9 Bb10 B11.
  const cases = [
    // triads
    ['C', [0, 4, 7]],
    ['Cm', [0, 3, 7]],
    ['Cdim', [0, 3, 6]],
    ['Caug', [0, 4, 8]],
    ['Csus2', [0, 2, 7]],
    ['Csus4', [0, 5, 7]],
    ['C5', [0, 7]],
    // sixths / add9
    ['C6', [0, 4, 7, 9]],
    ['Cm6', [0, 3, 7, 9]],
    ['Cadd9', [0, 2, 4, 7]],
    ['C6/9', [0, 2, 4, 7, 9]],
    ['Cm6/9', [0, 2, 3, 7, 9]],
    // sevenths
    ['Cmaj7', [0, 4, 7, 11]],
    ['C7', [0, 4, 7, 10]],
    ['Cm7', [0, 3, 7, 10]],
    ['Cm(maj7)', [0, 3, 7, 11]],
    ['Cdim7', [0, 3, 6, 9]],
    ['Cm7b5', [0, 3, 6, 10]],
    ['C7sus4', [0, 5, 7, 10]],
    // altered sevenths
    ['C7(b5)', [0, 4, 6, 10]],
    ['C7(#5)', [0, 4, 8, 10]],
    ['Cmaj7(b5)', [0, 4, 6, 11]],
    ['Cmaj7(#5)', [0, 4, 8, 11]],
    // ninths
    ['Cmaj9', [0, 2, 4, 7, 11]],
    ['C9', [0, 2, 4, 7, 10]],
    ['Cm9', [0, 2, 3, 7, 10]],
    ['C9sus4', [0, 2, 5, 7, 10]],
    // altered ninths
    ['C7(b9)', [0, 1, 4, 7, 10]],
    ['C7(#9)', [0, 3, 4, 7, 10]],
    ['C9(b5)', [0, 2, 4, 6, 10]],
    ['C9(#5)', [0, 2, 4, 8, 10]],
    ['Cm9b5', [0, 2, 3, 6, 10]],
  ]

  it.each(cases)('names %s', (name, pcs) => {
    expect(top(voice(pcs))).toBe(name)
  })
})

describe('identifyChords — enharmonic collisions resolve from the bass', () => {
  it('names the same 5 notes C6/9 when C is the bass', () => {
    // C E G A D (C in bass) vs the identical D9sus4 (D G A C E).
    expect(top(voice([0, 4, 7, 9, 2]))).toBe('C6/9')
  })
  it('names the same 5 notes D9sus4 when D is the bass', () => {
    expect(top(voice([2, 7, 9, 0, 4]))).toBe('D9sus4')
  })
  it('names a half-diminished from its bass, not the m6 inversion', () => {
    // C Eb Gb Bb is both Cm7b5 and Ebm6 — bass decides.
    expect(top(voice([0, 3, 6, 10]))).toBe('Cm7b5')
    expect(top(voice([3, 6, 10, 0]))).toBe('Ebm6')
  })
  it('names a 6th from its bass, not the relative m7', () => {
    // C E G A is both C6 and Am7 — bass decides.
    expect(top(voice([0, 4, 7, 9]))).toBe('C6')
    expect(top(voice([9, 0, 4, 7]))).toBe('Am7')
  })
})

describe('identifyChords — every C chord from the reference list', () => {
  // Driven by the *notes*, not the source list's (loose, sometimes inconsistent)
  // abbreviations. Within the implementation's scope — a triad + one 6th/7th +
  // up to one ninth-region tension (capped at the 9th) — every combination is
  // FULLY identified. A few are spelled from the more conventional enharmonic
  // root (the source's name is noted): the notes are the same.
  const inScope = [
    ['C E G', [0, 4, 7], 'C'],
    ['C F G', [0, 5, 7], 'Csus4'],
    ['C D G', [0, 2, 7], 'Csus2'],
    ['C Eb G', [0, 3, 7], 'Cm'],
    ['C Eb Gb', [0, 3, 6], 'Cdim'],
    ['C E G#', [0, 4, 8], 'Caug'],
    ['C E G A', [0, 4, 7, 9], 'C6'],
    ['C Eb G A', [0, 3, 7, 9], 'Cm6'],
    ['C E G A D', [0, 2, 4, 7, 9], 'C6/9'],
    ['C Eb G A D', [0, 2, 3, 7, 9], 'Cm6/9'],
    ['C E G B', [0, 4, 7, 11], 'Cmaj7'],
    ['C Eb G B', [0, 3, 7, 11], 'Cm(maj7)'],
    ['C E Gb B', [0, 4, 6, 11], 'Cmaj7(b5)'],
    ['C E G# B', [0, 4, 8, 11], 'Cmaj7(#5)'],
    ['C E G Bb', [0, 4, 7, 10], 'C7'],
    ['C F G Bb', [0, 5, 7, 10], 'C7sus4'],
    ['C E Gb Bb', [0, 4, 6, 10], 'C7(b5)'],
    ['C E G Bb Db', [0, 1, 4, 7, 10], 'C7(b9)'],
    ['C E G Bb D#', [0, 3, 4, 7, 10], 'C7(#9)'],
    ['C Eb G Bb', [0, 3, 7, 10], 'Cm7'],
    ['C Eb G# Bb', [0, 3, 8, 10], 'Abadd9/C'], // source: Cm7+5
    ['C Eb Gb Bb', [0, 3, 6, 10], 'Cm7b5'],
    ['C Eb Gb Bbb', [0, 3, 6, 9], 'Cdim7'],
    ['C E G# Bb', [0, 4, 8, 10], 'C7(#5)'],
    ['C E G# Bb Db', [0, 1, 4, 8, 10], 'Bbm9b5/C'], // source: C+7-9
    ['C E G Bb D', [0, 2, 4, 7, 10], 'C9'],
    ['C F G Bb D', [0, 2, 5, 7, 10], 'C9sus4'],
    ['C E Gb Bb D', [0, 2, 4, 6, 10], 'C9(b5)'],
    ['C E G B D', [0, 2, 4, 7, 11], 'Cmaj9'],
    ['C Eb G B D', [0, 2, 3, 7, 11], 'Cm(maj9)'],
    ['C Eb G Bb D', [0, 2, 3, 7, 10], 'Cm9'],
    ['C Eb Gb Bb D', [0, 2, 3, 6, 10], 'Cm9b5'],
    ['C E G# Bb D', [0, 2, 4, 8, 10], 'C9(#5)'],
  ]

  it.each(inScope)('fully identifies %s', (_notes, pcs, name) => {
    const [best] = identifyChords(voice(pcs))
    expect(best?.name).toBe(name)
    expect(best?.score.fullMatch).toBe(true)
  })

  // Beyond the implemented vocabulary: compound double-alterations, maj7(b9/#9),
  // and every 11th chord. The analyzer must stay graceful — never throw, and
  // never *fully* name them as one in-scope chord (the extra/clashing tone is
  // left unexplained). (7-note 13th chords are physically un-voiceable on six
  // strings, so the analyzer never receives them.)
  const outOfScope = [
    ['C E Gb B Db', [0, 1, 4, 6, 11]], // maj7b5b9
    ['C E Gb B D#', [0, 3, 4, 6, 11]], // maj7b5#9
    ['C E G# B Db', [0, 1, 4, 8, 11]], // maj7#5b9
    ['C E G# B D#', [0, 3, 4, 8, 11]], // maj7#5#9
    ['C E G B Db', [0, 1, 4, 7, 11]], // maj7b9
    ['C E G B D#', [0, 3, 4, 7, 11]], // maj7#9
    ['C E Gb Bb D#', [0, 3, 4, 6, 10]], // 7b5#9
    ['C Eb G Bb Db', [0, 1, 3, 7, 10]], // m7b9
    ['C E G# Bb D#', [0, 3, 4, 8, 10]], // 7#5#9
    ['C E Gb B D', [0, 2, 4, 6, 11]], // maj9b5
    ['C E G# B D', [0, 2, 4, 8, 11]], // maj9#5
    ['C E G Bb D F', [0, 2, 4, 5, 7, 10]], // C11
    ['C E Gb Bb D F', [0, 2, 4, 5, 6, 10]], // C11b5
    ['C E G# Bb D F', [0, 2, 4, 5, 8, 10]], // C11#5
    ['C E Gb Bb Db F', [0, 1, 4, 5, 6, 10]], // C11b5b9
    ['C E G# Bb D# F', [0, 3, 4, 5, 8, 10]], // C11#5#9
    ['C E G Bb Db F', [0, 1, 4, 5, 7, 10]], // C11b9
    ['C E G Bb D# F', [0, 3, 4, 5, 7, 10]], // C11#9
    ['C E G B D F', [0, 2, 4, 5, 7, 11]], // CM11
    ['C E Gb B D F', [0, 2, 4, 5, 6, 11]], // CM11b5
    ['C E G# B D F', [0, 2, 4, 5, 8, 11]], // CM11#5
    ['C E G# B Db F', [0, 1, 4, 5, 8, 11]], // CM11#5b9
    ['C E G# B D# F', [0, 3, 4, 5, 8, 11]], // CM11#5#9
    ['C E G B Db F', [0, 1, 4, 5, 7, 11]], // CM11b9
    ['C E G B D# F', [0, 3, 4, 5, 7, 11]], // CM11#9
    ['C Eb Gb B Db F', [0, 1, 3, 5, 6, 11]], // Cm11b5b9
  ]

  it.each(outOfScope)('handles %s as out of scope (no full match, no throw)', (_notes, pcs) => {
    const result = identifyChords(voice(pcs))
    expect(result[0]?.score.fullMatch ?? false).toBe(false)
  })
})

describe('identifyChords — improved interval breakdown', () => {
  it('labels chord tones by their role', () => {
    const [c7sharp9] = identifyChords(voice([0, 3, 4, 7, 10]))
    expect(c7sharp9.name).toBe('C7(#9)')
    expect(c7sharp9.intervals).toEqual(['R', '#9', '3', '5', 'b7'])
  })
  it('spells a half-diminished as R b3 b5 b7', () => {
    const [cm7b5] = identifyChords(voice([0, 3, 6, 10]))
    expect(cm7b5.intervals).toEqual(['R', 'b3', 'b5', 'b7'])
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
