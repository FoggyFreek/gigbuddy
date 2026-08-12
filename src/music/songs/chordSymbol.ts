// Split a chord symbol for superscript typesetting: the root (note + accidental,
// plus a minor `m`) stays on the baseline while the quality/extensions are
// superscripted, and a slash bass drops back to the baseline. Pure and
// dependency-free so it's shared by the React surfaces (ChordName) and the
// chords-over-lyrics HTML transform (chordpro.ts) alike.
//
//   Bb7(b9) -> { base: 'Bb',  sup: '7(b9)', bass: null }
//   Cm7     -> { base: 'Cm',  sup: '7',     bass: null }   (minor m kept down)
//   Cmaj7   -> { base: 'C',   sup: 'maj7',  bass: null }   (the m in maj stays up)
//   C7/G    -> { base: 'C',   sup: '7',     bass: 'G' }
//   C6/9    -> { base: 'C',   sup: '6/9',   bass: null }    (not a slash bass)

export interface ChordSymbolParts {
  base: string // baseline: note + accidental (+ minor m)
  sup: string // superscript: the quality/extensions (without the slash bass)
  bass: string | null // slash bass note, rendered '/<bass>' on the baseline
}

// note letter + optional accidental (ASCII b/# or Unicode ♭/♯).
const ROOT_RE = /^[A-G][#b♯♭]?/
// A trailing `/<note>` is a slash bass — but only when what follows the slash is
// a note (so the `/9` in `6/9` is left alone). Anchored to the end.
const BASS_RE = /\/([A-G][#b♯♭]?)$/
// A leading minor `m` that isn't the start of `maj`.
const MINOR_RE = /^m(?!aj)/

export function splitChordSymbol(name: string): ChordSymbolParts {
  const s = (name ?? '').trim()
  const root = ROOT_RE.exec(s)?.[0]
  // Not a chord (no A–G root): leave it whole on the baseline.
  if (!root) return { base: name ?? '', sup: '', bass: null }

  let rest = s.slice(root.length)

  let bass: string | null = null
  const bassMatch = BASS_RE.exec(rest)
  if (bassMatch) {
    bass = bassMatch[1]
    rest = rest.slice(0, bassMatch.index)
  }

  let base = root
  if (MINOR_RE.test(rest)) {
    base += 'm'
    rest = rest.slice(1)
  }

  return { base, sup: rest, bass }
}
