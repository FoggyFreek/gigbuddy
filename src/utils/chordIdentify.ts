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

export interface ScoreBreakdown {
  fullMatch: boolean // every sounding tone explained by the chord
  rootInBass: boolean // the lowest sounding note is the chord root (not a slash)
  explainedTones: number // distinct chord tones accounted for
  unexplainedTones: number // distinct tones left over (non-chord tones)
  fifthPresent: boolean // a fifth is voiced — a complete reading, preferred
  qualityRank: number // lower = simpler/more common quality
}

export interface ChordCandidate {
  name: string // "Am7", "C/G", "C7(#9)" (ASCII)
  rootPc: number
  quality: string // symbol: '', 'm', '7', 'maj7', 'm7b5', '7(#9)', … (ASCII)
  bassPc: number | null // set when the bass note is not the root (slash chord)
  notes: string[] // distinct sounding notes, low->high pitch
  intervals: string[] // chord-tone *role* labels (R, 3, b5, b7, #9, …)
  score: ScoreBreakdown
}

// --- Stacked-thirds decomposition (oolimo model) ---------------------------
//
// A chord is read as a root with one tone chosen per "slot": a third (the 2/m3/
// 3/sus4 branch), a fifth (b5/5/#5), a sixth-or-seventh, and — capped here at
// the 9th — a single ninth-region tension. Picking exactly one tone per slot is
// what enforces the spelling rules: a present m3 *and* major 3rd makes the m3 a
// #9; a present 4th alongside a real 3rd is an 11 (out of our 9th cap, so it
// falls to "unexplained") rather than a sus4. Anything a slot can't claim is an
// unexplained non-chord tone, which keeps the analyzer cautious on fragments and
// on 6+ note voicings beyond this cap.

type Third = 'maj' | 'min' | 'sus2' | 'sus4'
type Fifth = 'perfect' | 'dim' | 'aug'
type Seventh = 'maj7' | 'b7' | '6' | 'dim7'
type Ninth = 'b9' | '9' | '#9'

interface ChordSpec {
  third: Third | null
  fifth: Fifth | null
  seventh: Seventh | null
  ninths: Ninth[]
  power: boolean // pure root+5th, the one accepted two-note chord
  explained: number // distinct tones the slots account for (incl. root)
  unexplained: number // distinct tones left over (would-be 11/13/etc.)
}

const THIRD_INTERVAL: Record<Third, number> = { maj: 4, min: 3, sus2: 2, sus4: 5 }
const FIFTH_INTERVAL: Record<Fifth, number> = { perfect: 7, dim: 6, aug: 8 }
const SEVENTH_INTERVAL: Record<Seventh, number> = { maj7: 11, b7: 10, '6': 9, dim7: 9 }
const NINTH_INTERVAL: Record<Ninth, number> = { b9: 1, '9': 2, '#9': 3 }

const THIRD_LABEL: Record<Third, string> = { maj: '3', min: 'b3', sus2: '2', sus4: '4' }
const FIFTH_LABEL: Record<Fifth, string> = { perfect: '5', dim: 'b5', aug: '#5' }
const SEVENTH_LABEL: Record<Seventh, string> = { maj7: '7', b7: 'b7', '6': '6', dim7: 'bb7' }
// Fallback labels for the leftover (out-of-cap) tones, just for the breakdown.
const EXT_LABEL: Record<number, string> = { 5: '11', 6: '#11', 8: 'b13', 9: '13' }

// Conventional ranking of qualities (lower = more common); the bass note breaks
// ties. Enharmonically-identical qualities share a rank on purpose so the bass
// decides the spelling: C6 == Am7, Cm6 == Am7b5, C6/9 == D9sus4, C9(b5) ==
// D9(#5), Csus2 == Gsus4. A quality absent from this map is judged too exotic to
// name, so that reading is dropped (the analyzer says "no recognized chord"
// rather than inventing e.g. "Em(#5)" for a plain C triad).
const QUALITY_RANK = new Map<string, number>([
  ['', 0], ['m', 0],
  ['5', 1],
  ['7', 2], ['maj7', 2],
  ['6', 3], ['m7', 3],
  ['m6', 4], ['m7b5', 4],
  ['sus2', 5], ['sus4', 5],
  ['dim', 6], ['aug', 6], ['dim7', 6],
  ['9', 7], ['maj9', 7], ['m9', 7],
  ['add9', 8], ['m(add9)', 8], ['6/9', 8], ['m6/9', 8], ['9sus4', 8],
  ['m(maj7)', 9], ['m(maj9)', 9], ['7sus4', 9],
  ['7(b9)', 10], ['7(#9)', 10], ['7(b5)', 10], ['7(#5)', 10], ['9(b5)', 10], ['9(#5)', 10],
  ['maj7(b5)', 11], ['maj7(#5)', 11], ['m9b5', 11], ['m7(#5)', 11],
])

// Read an interval set (relative to a candidate root, including 0) into a spec,
// or null when there is no nameable chord here (no third, and not a power chord).
function decompose(intervals: Set<number>): ChordSpec | null {
  const has = (n: number): boolean => intervals.has(n)

  // The one accepted two-note chord: root + perfect fifth.
  if (intervals.size === 2 && has(0) && has(7)) {
    return { third: null, fifth: 'perfect', seventh: null, ninths: [], power: true, explained: 2, unexplained: 0 }
  }
  // Everything else needs at least a triad's worth of tones.
  if (intervals.size < 3) return null

  let third: Third | null = null
  if (has(4)) third = 'maj'
  else if (has(3)) third = 'min'
  else if (has(5)) third = 'sus4'
  else if (has(2)) third = 'sus2'
  if (third === null) return null

  let fifth: Fifth | null = null
  if (has(7)) fifth = 'perfect'
  else if (has(6)) fifth = 'dim'
  else if (has(8)) fifth = 'aug'

  let seventh: Seventh | null = null
  if (has(11)) seventh = 'maj7'
  else if (has(10)) seventh = 'b7'
  else if (has(9)) seventh = third === 'min' && fifth === 'dim' ? 'dim7' : '6'

  const ninths: Ninth[] = []
  if (has(1)) ninths.push('b9')
  if (has(2) && third !== 'sus2') ninths.push('9')
  if (has(3) && third === 'maj') ninths.push('#9') // a m3 over a major 3rd is #9

  const consumed = new Set<number>([0, THIRD_INTERVAL[third]])
  if (fifth) consumed.add(FIFTH_INTERVAL[fifth])
  if (seventh) consumed.add(SEVENTH_INTERVAL[seventh])
  for (const t of ninths) consumed.add(NINTH_INTERVAL[t])

  return {
    third,
    fifth,
    seventh,
    ninths,
    power: false,
    explained: consumed.size,
    unexplained: intervals.size - consumed.size,
  }
}

// The seventh part of a major-rooted symbol, folding a natural 9th into the
// chord number (b7+9 -> "9", maj7+9 -> "maj9", 6+9 -> "6/9", +9 with no 7 ->
// "add9"). Altered fifths/ninths are added by the caller as parenthesized tags.
function majorStem(seventh: Seventh | null, nat9: boolean): string {
  switch (seventh) {
    case 'maj7': return nat9 ? 'maj9' : 'maj7'
    case 'b7': return nat9 ? '9' : '7'
    case '6': return nat9 ? '6/9' : '6'
    default: return nat9 ? 'add9' : ''
  }
}

function minorStem(seventh: Seventh | null, nat9: boolean): string {
  switch (seventh) {
    case 'maj7': return nat9 ? 'm(maj9)' : 'm(maj7)'
    case 'b7': return nat9 ? 'm9' : 'm7'
    case '6': return nat9 ? 'm6/9' : 'm6'
    default: return nat9 ? 'm(add9)' : 'm'
  }
}

function susStem(sus: 'sus2' | 'sus4', seventh: Seventh | null, nat9: boolean): string {
  switch (seventh) {
    case 'maj7': return `maj7${sus}`
    case 'b7': return nat9 ? `9${sus}` : `7${sus}`
    case '6': return `6${sus}`
    default: return nat9 ? `${sus}(add9)` : sus
  }
}

// Minor + diminished fifth: the diminished / half-diminished family, where the
// b5 is structural (kept bare, like "m7b5") rather than a parenthesized tag.
function diminishedStem(seventh: Seventh | null, nat9: boolean): string {
  switch (seventh) {
    case 'dim7': return nat9 ? 'dim9' : 'dim7' // "dim9" isn't a name we keep — drop it
    case 'b7': return nat9 ? 'm9b5' : 'm7b5'
    case 'maj7': return nat9 ? 'm(maj9)b5' : 'm(maj7)b5'
    default: return nat9 ? 'dim(add9)' : 'dim'
  }
}

// Assemble the conventional symbol (without root or slash) from a spec.
function formatQuality(spec: ChordSpec): string {
  if (spec.power) return '5'
  const { third, fifth, seventh } = spec
  const nat9 = spec.ninths.includes('9')
  const alts = spec.ninths.filter((t) => t !== '9') as string[] // b9 / #9

  let core: string
  if (third === 'sus2' || third === 'sus4') {
    core = susStem(third, seventh, nat9)
    if (fifth === 'dim') alts.unshift('b5')
    else if (fifth === 'aug') alts.unshift('#5')
  } else if (third === 'min' && fifth === 'dim') {
    core = diminishedStem(seventh, nat9)
  } else if (third === 'maj' && fifth === 'aug') {
    if (seventh === null && !nat9) core = 'aug'
    else { core = majorStem(seventh, nat9); alts.unshift('#5') }
  } else if (third === 'min') {
    core = minorStem(seventh, nat9)
    if (fifth === 'aug') alts.unshift('#5')
  } else {
    core = majorStem(seventh, nat9)
    if (fifth === 'dim') alts.unshift('b5')
  }

  return alts.length ? `${core}(${alts.join(',')})` : core
}

// Role label for every sounding interval, in ascending order, for the breakdown.
function specIntervalLabels(spec: ChordSpec, intervals: Set<number>): string[] {
  const roleOf = new Map<number, string>([[0, 'R']])
  if (spec.third) roleOf.set(THIRD_INTERVAL[spec.third], THIRD_LABEL[spec.third])
  if (spec.fifth) roleOf.set(FIFTH_INTERVAL[spec.fifth], FIFTH_LABEL[spec.fifth])
  if (spec.seventh) roleOf.set(SEVENTH_INTERVAL[spec.seventh], SEVENTH_LABEL[spec.seventh])
  for (const t of spec.ninths) roleOf.set(NINTH_INTERVAL[t], t)
  return [...intervals].sort((a, b) => a - b).map((i) => roleOf.get(i) ?? EXT_LABEL[i] ?? `${i}`)
}

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

// Best-first: full match, then fewest leftover tones, then richest explanation,
// then simpler/more common quality, then root-in-bass (so equivalent qualities —
// C6 vs Am7, Cm7b5 vs Ebm6 — are spelled from the actual bass), then lowest root
// pitch class as a stable tiebreaker.
function compareCandidates(a: ChordCandidate, b: ChordCandidate): number {
  const sa = a.score
  const sb = b.score
  if (sa.fullMatch !== sb.fullMatch) return sa.fullMatch ? -1 : 1
  if (sa.unexplainedTones !== sb.unexplainedTones) return sa.unexplainedTones - sb.unexplainedTones
  if (sa.explainedTones !== sb.explainedTones) return sb.explainedTones - sa.explainedTones
  if (sa.fifthPresent !== sb.fifthPresent) return sa.fifthPresent ? -1 : 1
  if (sa.qualityRank !== sb.qualityRank) return sa.qualityRank - sb.qualityRank
  if (sa.rootInBass !== sb.rootInBass) return sa.rootInBass ? -1 : 1
  return a.rootPc - b.rootPc
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
    candidates.push(...candidatesForRoot(rootPc, presentPcs, bassPc, notesLowToHigh))
  }

  candidates.sort(compareCandidates)
  return dedupeByName(candidates)
}

// The chord the notes spell when read against `rootPc` as the root — at most one
// per root via the stacked-thirds decomposition. Readings whose quality isn't a
// recognized symbol are dropped, so the analyzer stays conventional and cautious.
function candidatesForRoot(
  rootPc: number,
  presentPcs: number[],
  bassPc: number,
  notesLowToHigh: number[],
): ChordCandidate[] {
  const intervals = new Set(presentPcs.map((pc) => ((pc - rootPc + 12) % 12)))
  const spec = decompose(intervals)
  if (!spec) return []

  const quality = formatQuality(spec)
  const qualityRank = QUALITY_RANK.get(quality)
  if (qualityRank === undefined) return [] // too exotic to name

  const rootInBass = bassPc === rootPc
  return [{
    name: formatChordName(rootPc, quality, rootInBass ? null : bassPc),
    rootPc,
    quality,
    bassPc: rootInBass ? null : bassPc,
    notes: notesLowToHigh.map((pc) => formatNote(pc, FLAT_ROOT_PCS.has(rootPc))),
    intervals: specIntervalLabels(spec, intervals),
    score: {
      fullMatch: spec.unexplained === 0,
      rootInBass,
      explainedTones: spec.explained,
      unexplainedTones: spec.unexplained,
      fifthPresent: spec.fifth !== null,
      qualityRank,
    },
  }]
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
