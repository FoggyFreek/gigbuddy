// Guitar chord *analyzer*: the inverse of guitarChords.ts. Given finger positions
// on the neck (absolute frets, low->high EADGBe), it works out which chord
// name(s) those notes spell — root + quality + optional slash bass — the way
// oolimo's analyzer does. Pure, dependency-free, and numeric throughout: pitch
// classes (0..11) drive the analysis; note/interval *spelling* happens only at
// the formatting edge so enharmonics stay testable. Accidentals are ASCII
// internally (b7, #5, m7b5); any prettier Unicode is a UI concern.

import type { ChordShape } from './guitarChords.ts'

// -1 = muted, 0 = open, 1..MAX_FRET = a fretted note.
export type AbsoluteFret = number

export const MAX_FRET = 24
const MUTE = -1

// Standard tuning, low string -> high, as MIDI note numbers (E2 A2 D3 G3 B3 E4).
export const STANDARD_TUNING: readonly number[] = [40, 45, 50, 55, 59, 64]

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
// Black-key roots conventionally spelled as flats (Db Eb Gb Ab Bb).
const FLAT_ROOT_PCS = new Set([1, 3, 6, 8, 10])

// Interval (semitones from root) -> chord-tone label, for the breakdown display.
const INTERVAL_LABELS: Record<number, string> = {
  0: 'R', 1: 'b2', 2: '2', 3: 'b3', 4: '3', 5: '4', 6: 'b5', 7: '5', 8: '#5', 9: '6', 10: 'b7', 11: '7',
}

export interface ScoreBreakdown {
  fullMatch: boolean // every sounding tone explained by the chord
  rootInBass: boolean // the lowest sounding note is the chord root (not a slash)
  explainedTones: number // distinct chord tones accounted for
  unexplainedTones: number // distinct tones left over (non-chord tones)
  qualityRank: number // lower = simpler/more common quality
}

export interface ChordCandidate {
  name: string // "Am7", "C/G", "Dsus4" (ASCII)
  rootPc: number
  quality: string // symbol: '', 'm', '7', 'maj7', 'sus4', 'dim', … (ASCII)
  bassPc: number | null // set when the bass note is not the root (slash chord)
  notes: string[] // distinct sounding notes, low->high pitch
  intervals: string[] // chord-tone labels relative to the root
  score: ScoreBreakdown
}

// Each quality is matched by *interval sets*, not a fixed shape: `required`
// tones must all be present, `forbidden` tones must all be absent, and any tone
// outside required+optional counts as an "unexplained" non-chord tone (penalized
// in ranking, not rejected). Optional fifths let omitted-5th sevenths still name
// while plain triads keep the 5th required, so two-note fragments stay cautious.
interface QualityDef {
  symbol: string
  required: number[]
  optional: number[]
  forbidden: number[]
  rank: number
}

const QUALITIES: QualityDef[] = [
  { symbol: '', required: [0, 4, 7], optional: [], forbidden: [3, 10, 11], rank: 1 },
  { symbol: 'm', required: [0, 3, 7], optional: [], forbidden: [4, 10, 11], rank: 2 },
  { symbol: '7', required: [0, 4, 10], optional: [7], forbidden: [3, 11], rank: 3 },
  { symbol: 'maj7', required: [0, 4, 11], optional: [7], forbidden: [3, 10], rank: 4 },
  { symbol: 'm7', required: [0, 3, 10], optional: [7], forbidden: [4, 11], rank: 5 },
  { symbol: '6', required: [0, 4, 9], optional: [7], forbidden: [3, 10, 11], rank: 6 },
  { symbol: 'm6', required: [0, 3, 9], optional: [7], forbidden: [4, 11], rank: 7 },
  { symbol: 'sus4', required: [0, 5, 7], optional: [], forbidden: [3, 4], rank: 8 },
  { symbol: 'sus2', required: [0, 2, 7], optional: [], forbidden: [3, 4], rank: 9 },
  { symbol: 'dim', required: [0, 3, 6], optional: [], forbidden: [4, 7, 9, 10, 11], rank: 10 },
  { symbol: 'aug', required: [0, 4, 8], optional: [], forbidden: [3, 7, 10, 11], rank: 11 },
  { symbol: 'm7b5', required: [0, 3, 6, 10], optional: [], forbidden: [4, 7, 11], rank: 12 },
  { symbol: 'dim7', required: [0, 3, 6, 9], optional: [], forbidden: [4, 7, 10, 11], rank: 13 },
  { symbol: 'add9', required: [0, 2, 4, 7], optional: [], forbidden: [3, 10, 11], rank: 14 },
  { symbol: '9', required: [0, 2, 4, 10], optional: [7], forbidden: [3, 11], rank: 15 },
  { symbol: 'maj9', required: [0, 2, 4, 11], optional: [7], forbidden: [3, 10], rank: 16 },
  { symbol: 'm9', required: [0, 2, 3, 10], optional: [7], forbidden: [4, 11], rank: 17 },
  { symbol: '5', required: [0, 7], optional: [], forbidden: [3, 4], rank: 20 },
]

function noteName(pc: number, preferFlat: boolean): string {
  return (preferFlat ? FLAT_NAMES : SHARP_NAMES)[((pc % 12) + 12) % 12]
}

// Public so the UI can spell a pitch class consistently with the analyzer.
export function formatNote(pc: number, preferFlat = FLAT_ROOT_PCS.has(((pc % 12) + 12) % 12)): string {
  return noteName(pc, preferFlat)
}

export function formatChordName(rootPc: number, quality: string, bassPc: number | null): string {
  const preferFlat = FLAT_ROOT_PCS.has(rootPc)
  const base = `${noteName(rootPc, preferFlat)}${quality}`
  if (bassPc === null || bassPc === rootPc) return base
  return `${base}/${noteName(bassPc, FLAT_ROOT_PCS.has(bassPc))}`
}

export function formatIntervals(intervals: number[]): string[] {
  return intervals.map((i) => INTERVAL_LABELS[((i % 12) + 12) % 12])
}

function assertValidFrets(frets: AbsoluteFret[]): void {
  if (!Array.isArray(frets) || frets.length !== 6) {
    throw new RangeError(`frets must be an array of exactly 6 strings, got ${frets?.length}`)
  }
  for (const f of frets) {
    if (!Number.isInteger(f) || f < MUTE || f > MAX_FRET) {
      throw new RangeError(`fret value must be -1 (mute) or 0..${MAX_FRET}, got ${f}`)
    }
  }
}

function assertValidTuning(tuning: readonly number[]): void {
  if (!Array.isArray(tuning) || tuning.length !== 6 || !tuning.every((m) => Number.isInteger(m))) {
    throw new RangeError('tuning must be an array of exactly 6 integer MIDI values')
  }
}

// Sounding MIDI pitches for the non-muted strings, low string -> high.
function soundingPitches(frets: AbsoluteFret[], tuning: readonly number[]): number[] {
  const out: number[] = []
  for (let i = 0; i < 6; i++) {
    if (frets[i] !== MUTE) out.push(tuning[i] + frets[i])
  }
  return out
}

function matchQuality(intervalSet: Set<number>, def: QualityDef): { explained: number; unexplained: number } | null {
  for (const r of def.required) if (!intervalSet.has(r)) return null
  for (const f of def.forbidden) if (intervalSet.has(f)) return null
  const allowed = new Set([...def.required, ...def.optional])
  let explained = 0
  let unexplained = 0
  for (const tone of intervalSet) {
    if (allowed.has(tone)) explained++
    else unexplained++
  }
  return { explained, unexplained }
}

// Best-first: full match, then fewest leftover tones, then richest explanation,
// then simpler/common quality, then non-slash, then lowest-string root.
function compareCandidates(a: ChordCandidate, b: ChordCandidate): number {
  const sa = a.score
  const sb = b.score
  if (sa.fullMatch !== sb.fullMatch) return sa.fullMatch ? -1 : 1
  if (sa.unexplainedTones !== sb.unexplainedTones) return sa.unexplainedTones - sb.unexplainedTones
  if (sa.explainedTones !== sb.explainedTones) return sb.explainedTones - sa.explainedTones
  if (sa.qualityRank !== sb.qualityRank) return sa.qualityRank - sb.qualityRank
  if (sa.rootInBass !== sb.rootInBass) return sa.rootInBass ? -1 : 1
  return 0
}

/**
 * Identify the chord(s) spelled by a set of finger positions. Returns an ordered
 * list of candidates, best first; an empty array when the notes don't form a
 * recognizable chord (e.g. a lone note or an ambiguous two-note fragment).
 *
 * @throws RangeError on malformed input (not 6 strings, non-integer/out-of-range
 *   frets, or a tuning that isn't 6 MIDI integers) — programmer error, since the
 *   UI keeps user input constrained.
 */
export function identifyChords(frets: AbsoluteFret[], tuning: readonly number[] = STANDARD_TUNING): ChordCandidate[] {
  assertValidFrets(frets)
  assertValidTuning(tuning)

  const pitches = soundingPitches(frets, tuning)
  if (pitches.length < 2) return []

  const bassPc = pitches[0] % 12 // lowest string is first
  const presentPcs = [...new Set(pitches.map((p) => p % 12))]
  const notesLowToHigh = dedupeNotes(pitches)

  const candidates: ChordCandidate[] = []
  for (const rootPc of presentPcs) {
    const intervals = new Set(presentPcs.map((pc) => ((pc - rootPc + 12) % 12)))
    for (const def of QUALITIES) {
      const m = matchQuality(intervals, def)
      if (!m) continue
      // Suppress noisy interpretations with several non-chord tones.
      if (m.unexplained > 1) continue
      const rootInBass = bassPc === rootPc
      candidates.push({
        name: formatChordName(rootPc, def.symbol, rootInBass ? null : bassPc),
        rootPc,
        quality: def.symbol,
        bassPc: rootInBass ? null : bassPc,
        notes: notesLowToHigh.map((pc) => formatNote(pc, FLAT_ROOT_PCS.has(rootPc))),
        intervals: formatIntervals([...intervals].sort((x, y) => x - y)),
        score: {
          fullMatch: m.unexplained === 0,
          rootInBass,
          explainedTones: m.explained,
          unexplainedTones: m.unexplained,
          qualityRank: def.rank,
        },
      })
    }
  }

  candidates.sort(compareCandidates)
  return dedupeByName(candidates)
}

function dedupeNotes(pitches: number[]): number[] {
  const seen = new Set<number>()
  const out: number[] = []
  for (const p of pitches) {
    const pc = p % 12
    if (!seen.has(pc)) {
      seen.add(pc)
      out.push(pc)
    }
  }
  return out
}

function dedupeByName(candidates: ChordCandidate[]): ChordCandidate[] {
  const seen = new Set<string>()
  const out: ChordCandidate[] = []
  for (const c of candidates) {
    if (!seen.has(c.name)) {
      seen.add(c.name)
      out.push(c)
    }
  }
  return out
}

/**
 * Convert absolute analyzer frets into a guitarChords {@link ChordShape} (frets
 * relative to `baseFret`, the convention ChordDiagram renders). Open (0) and
 * muted (-1) strings are preserved; a high-position voicing is normalized to a
 * compact baseFret so the diagram stays small instead of drawing 12 empty frets.
 */
export function absoluteFretsToChordShape(frets: AbsoluteFret[]): ChordShape {
  assertValidFrets(frets)
  const fretted = frets.filter((f) => f > 0)
  const maxFret = fretted.length ? Math.max(...fretted) : 0
  const minFret = fretted.length ? Math.min(...fretted) : 0
  // Stay in open position while the shape fits; otherwise shift the window down.
  const baseFret = maxFret <= 4 ? 1 : minFret
  const offset = baseFret - 1
  return {
    baseFret,
    frets: frets.map((f) => (f > 0 ? f - offset : f)),
  }
}
