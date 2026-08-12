import { STANDARD_TUNING, absoluteFretsToChordShape } from './chordIdentify.ts'

// Curated built-in guitar chord shapes, the app's stand-in for ChordPro's
// instrument config library: common chords (G, Em, Am, D7, …) have no {define}
// in a song, so their fretboard shapes come from here. A song's own
// {define}/{chord} directives override these (see analyzeChords).
//
// frets/fingers are low→high (EADGBe), matching the ChordPro {define} order:
// 0 = open, -1 = muted, n = fret (relative to baseFret − 1).
export interface ChordShape {
  baseFret: number
  frets: number[]
  fingers?: number[]
  keys?: number[]
}

const MUTE = -1

const CHORDS: Record<string, ChordShape> = {
  C: { baseFret: 1, frets: [MUTE, 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0] },
  C7: { baseFret: 1, frets: [MUTE, 3, 2, 3, 1, 0], fingers: [0, 3, 2, 4, 1, 0] },
  Cmaj7: { baseFret: 1, frets: [MUTE, 3, 2, 0, 0, 0] },
  Cadd9: { baseFret: 1, frets: [MUTE, 3, 2, 0, 3, 0], fingers: [0, 2, 1, 0, 3, 0] },
  Cm: { baseFret: 3, frets: [MUTE, 1, 3, 3, 2, 1], fingers: [0, 1, 3, 4, 2, 1] },
  D: { baseFret: 1, frets: [MUTE, MUTE, 0, 2, 3, 2], fingers: [0, 0, 0, 1, 3, 2] },
  D7: { baseFret: 1, frets: [MUTE, MUTE, 0, 2, 1, 2], fingers: [0, 0, 0, 2, 1, 3] },
  Dm: { baseFret: 1, frets: [MUTE, MUTE, 0, 2, 3, 1], fingers: [0, 0, 0, 2, 3, 1] },
  Dm7: { baseFret: 1, frets: [MUTE, MUTE, 0, 2, 1, 1], fingers: [0, 0, 0, 2, 1, 1] },
  Dsus2: { baseFret: 1, frets: [MUTE, MUTE, 0, 2, 3, 0], fingers: [0, 0, 0, 1, 3, 0] },
  Dsus4: { baseFret: 1, frets: [MUTE, MUTE, 0, 2, 3, 3], fingers: [0, 0, 0, 1, 3, 4] },
  E: { baseFret: 1, frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0] },
  E7: { baseFret: 1, frets: [0, 2, 0, 1, 0, 0], fingers: [0, 2, 0, 1, 0, 0] },
  Em: { baseFret: 1, frets: [0, 2, 2, 0, 0, 0], fingers: [0, 2, 3, 0, 0, 0] },
  Em7: { baseFret: 1, frets: [0, 2, 0, 0, 0, 0], fingers: [0, 2, 0, 0, 0, 0] },
  Esus4: { baseFret: 1, frets: [0, 2, 2, 2, 0, 0], fingers: [0, 1, 2, 3, 0, 0] },
  F: { baseFret: 1, frets: [1, 3, 3, 2, 1, 1], fingers: [1, 3, 4, 2, 1, 1] },
  Fm: { baseFret: 1, frets: [1, 3, 3, 1, 1, 1], fingers: [1, 3, 4, 1, 1, 1] },
  'F#m': { baseFret: 2, frets: [1, 3, 3, 1, 1, 1], fingers: [1, 3, 4, 1, 1, 1] },
  G: { baseFret: 1, frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, 0, 0, 0, 3] },
  G7: { baseFret: 1, frets: [3, 2, 0, 0, 0, 1], fingers: [3, 2, 0, 0, 0, 1] },
  Gm: { baseFret: 3, frets: [1, 3, 3, 1, 1, 1], fingers: [1, 3, 4, 1, 1, 1] },
  A: { baseFret: 1, frets: [0, 0, 2, 2, 2, 0], fingers: [0, 0, 1, 2, 3, 0] },
  A7: { baseFret: 1, frets: [0, 0, 2, 0, 2, 0], fingers: [0, 0, 2, 0, 3, 0] },
  Am: { baseFret: 1, frets: [0, 0, 2, 2, 1, 0], fingers: [0, 0, 2, 3, 1, 0] },
  Am7: { baseFret: 1, frets: [0, 0, 2, 0, 1, 0], fingers: [0, 0, 2, 0, 1, 0] },
  Asus2: { baseFret: 1, frets: [0, 0, 2, 2, 0, 0], fingers: [0, 0, 1, 2, 0, 0] },
  Asus4: { baseFret: 1, frets: [0, 0, 2, 2, 3, 0], fingers: [0, 0, 1, 2, 3, 0] },
  B7: { baseFret: 1, frets: [MUTE, 2, 1, 2, 0, 2], fingers: [0, 2, 1, 3, 0, 4] },
  Bm: { baseFret: 1, frets: [MUTE, 2, 4, 4, 3, 2], fingers: [0, 1, 3, 4, 2, 1] },
  Bb: { baseFret: 1, frets: [MUTE, 1, 3, 3, 3, 1], fingers: [0, 1, 2, 3, 4, 1] },
  B: { baseFret: 2, frets: [MUTE, 1, 3, 3, 3, 1], fingers: [0, 1, 2, 3, 4, 1] },

  // Accidental (barre) majors — A-shape (root 5th string) or E-shape (root 6th).
  // Both flat and sharp spellings are listed so either resolves.
  'A#': { baseFret: 1, frets: [MUTE, 1, 3, 3, 3, 1], fingers: [0, 1, 2, 3, 4, 1] },
  'C#': { baseFret: 4, frets: [MUTE, 1, 3, 3, 3, 1], fingers: [0, 1, 2, 3, 4, 1] },
  Db: { baseFret: 4, frets: [MUTE, 1, 3, 3, 3, 1], fingers: [0, 1, 2, 3, 4, 1] },
  'D#': { baseFret: 6, frets: [MUTE, 1, 3, 3, 3, 1], fingers: [0, 1, 2, 3, 4, 1] },
  Eb: { baseFret: 6, frets: [MUTE, 1, 3, 3, 3, 1], fingers: [0, 1, 2, 3, 4, 1] },
  'F#': { baseFret: 2, frets: [1, 3, 3, 2, 1, 1], fingers: [1, 3, 4, 2, 1, 1] },
  Gb: { baseFret: 2, frets: [1, 3, 3, 2, 1, 1], fingers: [1, 3, 4, 2, 1, 1] },
  'G#': { baseFret: 4, frets: [1, 3, 3, 2, 1, 1], fingers: [1, 3, 4, 2, 1, 1] },
  Ab: { baseFret: 4, frets: [1, 3, 3, 2, 1, 1], fingers: [1, 3, 4, 2, 1, 1] },

  // Accidental (barre) minors — A-shape minor or E-shape minor.
  'A#m': { baseFret: 1, frets: [MUTE, 1, 3, 3, 2, 1], fingers: [0, 1, 3, 4, 2, 1] },
  Bbm: { baseFret: 1, frets: [MUTE, 1, 3, 3, 2, 1], fingers: [0, 1, 3, 4, 2, 1] },
  'C#m': { baseFret: 4, frets: [MUTE, 1, 3, 3, 2, 1], fingers: [0, 1, 3, 4, 2, 1] },
  Dbm: { baseFret: 4, frets: [MUTE, 1, 3, 3, 2, 1], fingers: [0, 1, 3, 4, 2, 1] },
  'D#m': { baseFret: 6, frets: [MUTE, 1, 3, 3, 2, 1], fingers: [0, 1, 3, 4, 2, 1] },
  Ebm: { baseFret: 6, frets: [MUTE, 1, 3, 3, 2, 1], fingers: [0, 1, 3, 4, 2, 1] },
  'G#m': { baseFret: 4, frets: [1, 3, 3, 1, 1, 1], fingers: [1, 3, 4, 1, 1, 1] },
  Abm: { baseFret: 4, frets: [1, 3, 3, 1, 1, 1], fingers: [1, 3, 4, 1, 1, 1] },
}

const chordShape = (baseFret: number, frets: number[]): ChordShape => ({
  baseFret,
  frets,
})

function addChord(names: readonly string[], shape: ChordShape): void {
  for (const name of names) {
    CHORDS[name] ??= shape
  }
}

function addAlias(name: string, target: string): void {
  const shape = CHORDS[target]
  if (shape) CHORDS[name] ??= shape
}

// Additional variants from the TrueFire chart: 6, 9, minor 6/7, maj7,
// diminished, augmented, and sus. Existing open-position voicings above stay
// preferred; these fill the gaps with common open or movable shapes.
const OPEN_CHART_VARIANTS: Record<string, Record<string, ChordShape>> = {
  A: {
    '6': { baseFret: 1, frets: [MUTE, 0, 2, 2, 2, 2] },
    '9': { baseFret: 1, frets: [MUTE, 0, 2, 4, 2, 3] },
    m6: { baseFret: 1, frets: [MUTE, 0, 2, 2, 1, 2] },
    maj7: { baseFret: 1, frets: [MUTE, 0, 2, 1, 2, 0] },
    dim: { baseFret: 1, frets: [MUTE, MUTE, 1, 2, 1, 2] },
    '+': { baseFret: 1, frets: [MUTE, 0, 3, 2, 2, 1] },
  },
  C: {
    '6': { baseFret: 1, frets: [MUTE, 3, 2, 2, 1, 0] },
    '9': { baseFret: 1, frets: [MUTE, 3, 2, 3, 3, 3] },
    m6: { baseFret: 1, frets: [MUTE, 3, 1, 2, 1, 3] },
    m7: { baseFret: 1, frets: [MUTE, 3, 1, 3, 1, 3] },
    dim: { baseFret: 1, frets: [MUTE, MUTE, 1, 2, 1, 2] },
    '+': { baseFret: 1, frets: [MUTE, 3, 2, 1, 1, 0] },
    sus: { baseFret: 1, frets: [MUTE, 3, 3, 0, 1, 1] },
  },
  D: {
    '6': { baseFret: 1, frets: [MUTE, MUTE, 0, 2, 0, 2] },
    '9': { baseFret: 1, frets: [MUTE, 5, 4, 5, 5, MUTE] },
    m6: { baseFret: 1, frets: [MUTE, MUTE, 0, 2, 0, 1] },
    maj7: { baseFret: 1, frets: [MUTE, MUTE, 0, 2, 2, 2] },
    dim: { baseFret: 1, frets: [MUTE, MUTE, 0, 1, 0, 1] },
    '+': { baseFret: 1, frets: [MUTE, MUTE, 0, 3, 3, 2] },
  },
  E: {
    '6': { baseFret: 1, frets: [0, 2, 2, 1, 2, 0] },
    '9': { baseFret: 1, frets: [0, 2, 0, 1, 0, 2] },
    m6: { baseFret: 1, frets: [0, 2, 2, 0, 2, 0] },
    maj7: { baseFret: 1, frets: [0, 2, 1, 1, 0, 0] },
    dim: { baseFret: 1, frets: [MUTE, MUTE, 2, 3, 2, 3] },
    '+': { baseFret: 1, frets: [0, 3, 2, 1, 1, 0] },
  },
  G: {
    '6': { baseFret: 1, frets: [3, 2, 0, 0, 0, 0] },
    '9': { baseFret: 1, frets: [3, 0, 0, 2, 0, 1] },
  },
}

for (const [root, variants] of Object.entries(OPEN_CHART_VARIANTS)) {
  for (const [suffix, shape] of Object.entries(variants)) {
    addChord([`${root}${suffix}`], shape)
  }
}

const A_SHAPE_VARIANTS: Record<string, number[]> = {
  '6': [MUTE, 1, 3, 3, 3, 3],
  '7': [MUTE, 1, 3, 1, 3, 1],
  m6: [MUTE, 1, 3, 3, 2, 3],
  m7: [MUTE, 1, 3, 1, 2, 1],
  maj7: [MUTE, 1, 3, 2, 3, 1],
  '+': [MUTE, 1, 4, 3, 3, 2],
  sus: [MUTE, 1, 3, 3, 4, 1],
}

const E_SHAPE_VARIANTS: Record<string, number[]> = {
  '6': [1, 3, 3, 2, 3, 1],
  '7': [1, 3, 1, 2, 1, 1],
  '9': [1, 3, 1, 2, 1, 3],
  m6: [1, 3, 3, 1, 3, 1],
  m7: [1, 3, 1, 1, 1, 1],
  maj7: [1, 3, 2, 2, 1, 1],
  dim: [1, 2, 3, 1, 3, 1],
  '+': [1, 4, 3, 2, 2, 1],
  sus: [1, 3, 3, 3, 1, 1],
}

const A_SHAPE_ROOTS: Array<{ names: readonly string[]; baseFret: number }> = [
  { names: ['A#', 'Bb'], baseFret: 1 },
  { names: ['B'], baseFret: 2 },
  { names: ['C'], baseFret: 3 },
  { names: ['C#', 'Db'], baseFret: 4 },
  { names: ['D'], baseFret: 5 },
  { names: ['D#', 'Eb'], baseFret: 6 },
  { names: ['E'], baseFret: 7 },
]

const E_SHAPE_ROOTS: Array<{ names: readonly string[]; baseFret: number }> = [
  { names: ['F'], baseFret: 1 },
  { names: ['F#', 'Gb'], baseFret: 2 },
  { names: ['G'], baseFret: 3 },
  { names: ['G#', 'Ab'], baseFret: 4 },
]

for (const { names, baseFret } of A_SHAPE_ROOTS) {
  for (const [suffix, frets] of Object.entries(A_SHAPE_VARIANTS)) {
    addChord(names.map((name) => `${name}${suffix}`), chordShape(baseFret, frets))
  }
}

const A_SHAPE_NINTHS: Array<{ names: readonly string[]; frets: number[] }> = [
  { names: ['A#9', 'Bb9'], frets: [MUTE, 1, 0, 1, 1, 1] },
  { names: ['B9'], frets: [MUTE, 2, 1, 2, 2, 2] },
  { names: ['C#9', 'Db9'], frets: [MUTE, 4, 3, 4, 4, 4] },
  { names: ['D#9', 'Eb9'], frets: [MUTE, 6, 5, 6, 6, 6] },
]

for (const { names, frets } of A_SHAPE_NINTHS) addChord(names, { baseFret: 1, frets })

for (const { names, baseFret } of E_SHAPE_ROOTS) {
  for (const [suffix, frets] of Object.entries(E_SHAPE_VARIANTS)) {
    addChord(names.map((name) => `${name}${suffix}`), chordShape(baseFret, frets))
  }
}

const DIMINISHED_SHAPES: Array<{ names: readonly string[]; shape: ChordShape }> = [
  { names: ['A#dim', 'Bbdim'], shape: { baseFret: 1, frets: [MUTE, 1, 2, 0, 2, 0] } },
  { names: ['Bdim'], shape: { baseFret: 1, frets: [MUTE, 2, 3, 1, 3, MUTE] } },
  { names: ['C#dim', 'Dbdim'], shape: { baseFret: 1, frets: [MUTE, MUTE, 2, 3, 2, 3] } },
  { names: ['D#dim', 'Ebdim'], shape: { baseFret: 1, frets: [MUTE, MUTE, 1, 2, 1, 2] } },
  { names: ['Edim'], shape: { baseFret: 1, frets: [MUTE, MUTE, 2, 3, 2, 3] } },
]

for (const { names, shape } of DIMINISHED_SHAPES) addChord(names, shape)

for (const root of ['A', 'A#', 'Bb', 'B', 'C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab']) {
  addAlias(`${root}sus`, `${root}sus4`)
  addAlias(`${root}sus4`, `${root}sus`)
}

const ENHARMONIC_FLAT_ROOTS: Array<{ alias: string; target: string }> = [
  { alias: 'Cb', target: 'B' },
  { alias: 'Fb', target: 'E' },
  { alias: 'Gb', target: 'F#' },
]

const CHORD_SUFFIX_ALIASES = ['', 'm', '6', '7', '9', 'm6', 'm7', 'maj7', 'dim', '+', 'sus', 'sus4', 'sus2', 'add9']

for (const { alias, target } of ENHARMONIC_FLAT_ROOTS) {
  for (const suffix of CHORD_SUFFIX_ALIASES) {
    addAlias(`${alias}${suffix}`, `${target}${suffix}`)
  }
}

// Semitone of each natural note within an octave (C=0); H is German B.
const NOTE_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11, H: 11 }

// Pitch class (0..11) of a slash-bass note name ("F", "F#", "Bb"), or null when
// it isn't a plain note (e.g. the "9" in "C6/9", which is not a slash bass).
function bassNoteToPc(note: string): number | null {
  const m = /^([A-Ha-h])([#b]?)$/.exec(note.trim())
  if (!m) return null
  const base = NOTE_PC[m[1].toUpperCase()]
  if (base === undefined) return null
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0
  return (base + accidental + 12) % 12
}

// The bass note is voiced on one of the three low strings (low-E, A, D) — where
// a slash bass actually sits on a guitar. Higher strings can also sound the same
// pitch class, but never as a *bass*.
const BASS_STRINGS = [0, 1, 2] as const

// Re-voice a base chord shape so its lowest sounding string plays `bassPc` (the
// slash-bass note). Places the bass at the lowest fret across the low strings
// (ties → lowest string), mutes every string below it, and keeps the base
// shape's upper strings. Fingers are dropped — the base fingering no longer
// applies. Returns null for a keyboard/empty define (no guitar strings to move).
function applyBassNote(base: ChordShape, bassPc: number): ChordShape | null {
  if (base.frets.length !== STANDARD_TUNING.length) return null

  // Base shape in absolute (nut-relative) frets: mute (-1) and open (0) stay,
  // fretted values shift up by the shape's fret window.
  const abs = base.frets.map((f) => (f > 0 ? f + base.baseFret - 1 : f))

  let bassString = -1
  let bassFret = Infinity
  for (const i of BASS_STRINGS) {
    const openPc = (((STANDARD_TUNING[i] % 12) + 12) % 12)
    const fret = (bassPc - openPc + 12) % 12 // lowest fret on this string for the bass note
    if (fret < bassFret) {
      bassFret = fret
      bassString = i
    }
  }
  if (bassString === -1) return null

  abs[bassString] = bassFret
  for (let i = 0; i < bassString; i++) abs[i] = MUTE
  return absoluteFretsToChordShape(abs)
}

// Resolve a chord name (e.g. "Am7/G") to a built-in shape, or null. Tries the
// exact name first, then a slash chord: the part before the "/" gives the base
// shape and the note after it is re-voiced into the bass (see applyBassNote).
// Unicode accidentals are folded to ASCII first.
export function lookupGuitarChord(name: string): ChordShape | null {
  const n = (name ?? '')
    .trim()
    .replace(/♯/g, '#')
    .replace(/♭/g, 'b')
    .replace(/^([a-h])/, (_, root: string) => root.toUpperCase())
    .replace(/\/([a-h])(?=[#b]?$)/, (_, bass: string) => `/${bass.toUpperCase()}`)
  if (!n) return null
  if (CHORDS[n]) return CHORDS[n]

  const slashAt = n.indexOf('/')
  if (slashAt === -1) return null

  const base = CHORDS[n.slice(0, slashAt)]
  if (!base) return null

  const bassPc = bassNoteToPc(n.slice(slashAt + 1))
  if (bassPc === null) return base // not a real bass note (e.g. "C6/9") → plain base shape
  return applyBassNote(base, bassPc) ?? base
}
