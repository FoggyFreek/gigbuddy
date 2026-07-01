// ChordPro rendering helpers, shared by the on-screen viewer and the
// print-to-PDF window.
//
// A ChordPro file mixes plain chords-over-lyrics with richer directives this
// app renders specially: embedded ABC music notation ({start_of_abc}, engraved
// with abcjs), images, multi-column layout ({columns}/{colb}) and aligned text
// blocks. parseChordProDocument splits the source into ordered blocks so the
// view can lay them out; each chords-over-lyrics run is handed to ChordSheetJS.
//
// ChordSheetJS does NOT escape lyric/chord text, so its HTML is run through
// DOMPurify before it reaches the DOM (a malicious uploaded .cho could otherwise
// inject script — stored XSS, even intra-tenant).
import { ChordProParser, HtmlDivFormatter, Chord } from 'chordsheetjs'
import DOMPurify from 'dompurify'
import { lookupGuitarChord } from './guitarChords.ts'
import type { ChordShape } from './guitarChords.ts'
import { splitChordSymbol } from './chordSymbol.ts'

export type TextAlign = 'left' | 'center' | 'right'

// Consolas-first monospace stack (with cross-platform fallbacks) for tabs and
// the source editor — a fixed advance width keeps tab columns aligned.
export const MONO_FONT = 'Consolas, "DejaVu Sans Mono", "Liberation Mono", Menlo, Monaco, "Courier New", monospace'

// Grid layout metrics — a beat-cell and a bar-line slot are each a fixed width so
// chords stay vertically aligned across rows regardless of the author's source
// spacing (the official renderer aligns by shape, not by whitespace). Bars are
// left-aligned in the slot so the first stroke of a `|` and a `||` share the same
// x across rows; the slot is wide enough to hold the widest common bar (`:|:`).
export const GRID_CELL_W = '3em'
export const GRID_BAR_W = '1.8em'

export type DocBlock =
  | { kind: 'abc'; abc: string }
  | { kind: 'chordpro'; source: string }
  | { kind: 'textblock'; text: string; align: TextAlign }
  | { kind: 'image'; src: string; anchored: boolean; scale: string | null }
  | { kind: 'comment'; text: string; variant: 'box' | 'italic' }
  | { kind: 'chorddef'; name: string; shape: ChordShape | null }
  | { kind: 'tab'; text: string; label: string | null }
  | { kind: 'grid'; lines: string[]; label: string | null; shape: string | null }
  | { kind: 'colb' }

export interface ChordProDocument {
  columns: number
  blocks: DocBlock[]
  warnings: string[]
}

// ---------- metadata ----------

export interface MetaItem { key: string; label: string; value: string }
export interface SongMeta { title: string | null; subtitle: string | null; items: MetaItem[] }

// Directive (and shorthand) → canonical metadata key + display label. Title and
// subtitle are rendered as the header heading; the rest become a compact info row.
const META_DIRECTIVES: Record<string, { key: string; label: string }> = {
  title: { key: 'title', label: 'Title' }, t: { key: 'title', label: 'Title' },
  subtitle: { key: 'subtitle', label: 'Subtitle' }, st: { key: 'subtitle', label: 'Subtitle' },
  artist: { key: 'artist', label: 'Artist' },
  composer: { key: 'composer', label: 'Composer' },
  lyricist: { key: 'lyricist', label: 'Lyricist' },
  album: { key: 'album', label: 'Album' },
  year: { key: 'year', label: 'Year' },
  key: { key: 'key', label: 'Key' },
  capo: { key: 'capo', label: 'Capo' },
  tempo: { key: 'tempo', label: 'Tempo' },
  time: { key: 'time', label: 'Time' },
  duration: { key: 'duration', label: 'Duration' },
  copyright: { key: 'copyright', label: '©' },
}
const META_INFO_ORDER = ['key', 'capo', 'tempo', 'time', 'duration', 'artist', 'composer', 'lyricist', 'album', 'year', 'copyright']

// Parse a single metadata directive line (`{key: value}`, `{key value}`, or
// `{meta: key value}`). Returns null for any non-metadata directive/line.
function parseMetaLine(trimmed: string): MetaItem | null {
  const m = /^\{([a-z_]+)(?:[:\s]+([\s\S]*?))?\}$/i.exec(trimmed)
  if (!m) return null
  let dir = m[1].toLowerCase()
  let value = (m[2] ?? '').trim()
  if (dir === 'meta') {
    const parts = value.split(/\s+/)
    dir = (parts.shift() ?? '').toLowerCase()
    value = parts.join(' ').trim()
  }
  const def = META_DIRECTIVES[dir]
  return def && value ? { key: def.key, label: def.label, value } : null
}

// Pull a song's display metadata (title/subtitle + an ordered info row) from the
// source. ChordSheetJS only renders title/subtitle, so we surface the rest here.
export function extractMetadata(source: string): SongMeta {
  let title: string | null = null
  let subtitle: string | null = null
  const items: MetaItem[] = []
  const seen = new Set<string>()
  for (const line of (source ?? '').split('\n')) {
    const parsed = parseMetaLine(line.trim())
    if (!parsed) continue
    if (parsed.key === 'title') { title = parsed.value; continue }
    if (parsed.key === 'subtitle') { subtitle = parsed.value; continue }
    if (seen.has(parsed.key)) continue
    seen.add(parsed.key)
    items.push(parsed)
  }
  items.sort((a, b) => META_INFO_ORDER.indexOf(a.key) - META_INFO_ORDER.indexOf(b.key))
  return { title, subtitle, items }
}

export interface ChordProSongFields {
  title: string | null
  artist: string | null
  song_key: string | null
  tempo: number | null
}

// Pull the song-record fields (title, artist, key, tempo) from a ChordPro source,
// for seeding a new song when a .pro file is imported. Returns null for any field
// the file doesn't carry; tempo keeps only a leading integer (`{tempo: 120 BPM}`).
export function songFieldsFromChordPro(source: string): ChordProSongFields {
  const meta = extractMetadata(source)
  const find = (key: string): string | null => meta.items.find((i) => i.key === key)?.value ?? null
  const tempoNum = parseInt(find('tempo') ?? '', 10)
  return {
    title: meta.title,
    artist: find('artist'),
    song_key: find('key'),
    tempo: Number.isFinite(tempoNum) ? tempoNum : null,
  }
}

// {comment_box}/{comment_italic} (and shorthands) — ChordSheetJS silently drops
// these, so we capture and render them ourselves.
const SKIPPED_LYRIC_BLOCKS = new Set(['abc', 'tab', 'grid', 'textblock'])
const RE_BLOCK_START = /^\{(?:start_of_|so)(abc|tab|grid|textblock)\b/i
const RE_BLOCK_END = /^\{(?:end_of_|eo)(abc|tab|grid|textblock)\}$/i

function escapeLyricsHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function stripChordProInlineMarkup(line: string): string {
  return line
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Extract editable lyrics from a ChordPro source for the song's rich-text
// lyrics field. Chord/directive markup is discarded and each lyric line becomes
// one simple paragraph of HTML.
export function lyricsHtmlFromChordPro(source: string): string {
  const paragraphs: string[] = []
  let skippedBlock: string | null = null

  for (const line of (source ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = line.trim()

    if (skippedBlock) {
      if (RE_BLOCK_END.test(trimmed)) skippedBlock = null
      continue
    }

    const blockStart = RE_BLOCK_START.exec(trimmed)
    if (blockStart && SKIPPED_LYRIC_BLOCKS.has(blockStart[1].toLowerCase())) {
      skippedBlock = blockStart[1].toLowerCase()
      continue
    }

    if (!trimmed || parseMetaLine(trimmed) || /^\{[^}]*\}$/.test(trimmed)) continue

    const lyricLine = stripChordProInlineMarkup(line)
    if (lyricLine) paragraphs.push(`<p>${escapeLyricsHtml(lyricLine)}</p>`)
  }

  return paragraphs.join('')
}

const RE_COMMENT_STYLED = /^\{(comment_box|cb|comment_italic|ci)\b[:\s]+(.+)\}$/i

const RE_TRANSPOSE = /^\{transpose[:\s]+(-?\d+)\}/i

// Net semitone transposition requested by {transpose: n} directives. ChordSheetJS
// parses the directive but does NOT apply it, so we read the value and call
// song.transpose() ourselves. Multiple directives sum (the common case is one).
export function getTransposeAmount(source: string): number {
  let total = 0
  for (const line of (source ?? '').split('\n')) {
    const m = RE_TRANSPOSE.exec(line.trim())
    if (m) total += Number(m[1])
  }
  return total
}

// Rewrite each `.chord` cell so its quality is superscripted (Bb7(b9) ->
// Bb<sup>7(b9)</sup>), matching the React <ChordName> on the other surfaces. Runs
// after sanitize on already-safe HTML, building nodes via the DOM API (never
// innerHTML) so no untrusted text is reinterpreted as markup. The <sup> carries
// to print via the browser's default styling plus CHORDPRO_PRINT_CSS.
function superscriptChordCells(html: string): string {
  if (typeof document === 'undefined') return html // no DOM (SSR) — leave as-is
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  for (const el of tpl.content.querySelectorAll('.chord')) {
    const { base, sup, bass } = splitChordSymbol(el.textContent ?? '')
    if (!sup) continue // nothing to raise (bare root, empty cell, non-chord)
    el.textContent = base
    const s = document.createElement('sup')
    s.textContent = sup
    el.appendChild(s)
    if (bass !== null) el.appendChild(document.createTextNode(`/${bass}`))
  }
  return tpl.innerHTML
}

// Parse + format a chords-over-lyrics run + sanitize, applying `transpose`
// semitones. Returns sanitized HTML, or null when the source can't be parsed so
// callers can fall back to raw text.
export function renderChordProHtml(source: string, transpose = 0): string | null {
  try {
    let song = new ChordProParser().parse(source ?? '')
    if (transpose) song = song.transpose(transpose)
    const html = new HtmlDivFormatter().format(song)
    return superscriptChordCells(DOMPurify.sanitize(html))
  } catch {
    return null
  }
}

const RE_COLUMNS = /^\{(?:columns?|col)(?:[:\s]+(\d+))?\}$/i
const RE_COLB = /^\{(?:colb|column_break)\}$/i
const RE_DIAGRAMS = /^\{diagrams\b/i
const RE_ABC_START = /^\{start_of_abc\b/i
const RE_ABC_END = /^\{end_of_abc\}$/i
const RE_TEXTBLOCK_START = /^\{start_of_textblock\b([^}]*)\}/i
const RE_TEXTBLOCK_END = /^\{end_of_textblock\}$/i
const RE_TAB_START = /^\{(?:start_of_tab|sot)\b([^}]*)\}/i
const RE_TAB_END = /^\{(?:end_of_tab|eot)\}$/i
const RE_GRID_START = /^\{(?:start_of_grid|sog)\b([^}]*)\}/i
const RE_GRID_END = /^\{(?:end_of_grid|eog)\}$/i
const RE_IMAGE = /^\{image\b([^}]*)\}/i
// {chord} is display-only and inline (unlike {define}, which registers a reusable
// shape). Matched here so it renders at its source position; {chordfont}/{chordcolour}
// won't match (no word boundary after "chord").
const RE_CHORD_INLINE = /^\{chord\b[:\s]+(.+)\}$/i

// Read a section label: `label="X"` or the legacy `: X` form.
function readLabel(arg: string): string | null {
  const keyed = readAttr(arg, 'label')
  if (keyed) return keyed
  const legacy = arg.replace(/^[:\s]+/, '').trim()
  return legacy && !legacy.includes('=') ? legacy : null
}

// Read a grid shape: the keyed `shape="…"` form, or the legacy bare arg
// (`{sog: 4x4}`, `{sog: 16}`) when it looks like a shape (so it isn't mistaken
// for a label).
function readGridShape(arg: string): string | null {
  const keyed = readAttr(arg, 'shape')
  if (keyed) return keyed
  const bare = arg.replace(/^[:\s]+/, '').trim()
  return /^(?:(?:\d+\+)?\d+x\d+(?:\+\d+)?|\d+)$/.test(bare) ? bare : null
}

// Read an HTML-style attribute (name="v", name='v', or name=bare) from a
// directive's argument string.
function readAttr(attrs: string, name: string): string | null {
  const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"|${name}\\s*=\\s*'([^']*)'|${name}\\s*=\\s*([^\\s}]+)`, 'i').exec(attrs)
  return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null
}

function readAlign(attrs: string): TextAlign {
  const m = /(?:align|flush)\s*=\s*["']?(left|right|center)/i.exec(attrs)
  return (m?.[1]?.toLowerCase() as TextAlign) ?? 'left'
}

// Only allow http(s) image sources; anything else (javascript:, data:) is dropped.
export function safeImageSrc(src: string): string | null {
  return /^https?:\/\//i.test(src.trim()) ? src.trim() : null
}

// A block environment ({start_of_*}…{end_of_*}) resolved to its emitted block,
// the index of its terminator line (or EOF), any warnings, and the grid shape to
// carry forward (unchanged for non-grid environments).
interface EnvResult { block: DocBlock; end: number; warnings: string[]; shape: string | null }

// Collect a block environment's body: the lines after `start` up to (but not
// including) the first line matching `endRe`. `end` is the terminator's index, or
// lines.length when the block runs to EOF; `closed` is false in that EOF case.
function scanEnvBody(lines: string[], start: number, endRe: RegExp): { body: string[]; end: number; closed: boolean } {
  const body: string[] = []
  let i = start + 1
  while (i < lines.length && !endRe.test(lines[i].trim())) { body.push(lines[i]); i++ }
  return { body, end: i, closed: i < lines.length }
}

// Grid (Jazz Grille): laid out by shape in the component (fixed-width cells + bar
// slots) so chords align vertically. Only a keyed label="…" is a label; the
// legacy bare arg is the shape (`{sog: 4x4}`), captured as `shape`.
function readGridBlock(lines: string[], start: number, arg: string, lastGridShape: string | null): EnvResult {
  const warnings: string[] = []
  const gridLabel = readAttr(arg, 'label')
  // Legacy `{start_of_grid: …}` (colon) form can't carry key=value properties.
  if (/^\s*:/.test(arg) && /=/.test(arg)) {
    warnings.push('Legacy {start_of_grid: …} syntax cannot take properties; use the shape="…"/label="…" form.')
  }
  // An explicit shape="…" that we can't parse is surfaced, not silently dropped.
  const rawShapeAttr = readAttr(arg, 'shape')
  if (rawShapeAttr && !isValidGridShape(rawShapeAttr)) {
    warnings.push(`Unrecognized grid shape "${rawShapeAttr}"; expected forms like 16, 4x4, or 1+4x4+1.`)
  }
  // Resolve the active shape: an explicit valid shape, else reuse the previous
  // grid's shape (per spec); a null shape renders with the 1+4x4+1 default.
  const candidate = readGridShape(arg)
  const validShape = candidate && isValidGridShape(candidate) ? candidate : null
  const shape = validShape ?? lastGridShape
  const { body, end, closed } = scanEnvBody(lines, start, RE_GRID_END)
  if (!closed) warnings.push('Grid block is missing its {end_of_grid}/{eog}.')
  for (const gl of body) warnings.push(...gridLineWarnings(gl))
  return { block: { kind: 'grid', lines: body, label: gridLabel, shape }, end, warnings, shape }
}

// Resolve a multi-line block environment starting at `trimmed`, or null when the
// line doesn't open one (ABC, textblock, tab, grid). The tab environment is owned
// so it renders as a real <pre>: fixed-width font, exact whitespace, no wrapping —
// ChordSheetJS's flex .literal can't promise perfect column alignment.
function readEnvironment(lines: string[], start: number, trimmed: string, lastGridShape: string | null): EnvResult | null {
  if (RE_ABC_START.test(trimmed)) {
    const { body, end } = scanEnvBody(lines, start, RE_ABC_END)
    return { block: { kind: 'abc', abc: body.join('\n') }, end, warnings: [], shape: lastGridShape }
  }
  const mTb = RE_TEXTBLOCK_START.exec(trimmed)
  if (mTb) {
    const { body, end } = scanEnvBody(lines, start, RE_TEXTBLOCK_END)
    return { block: { kind: 'textblock', text: body.join('\n'), align: readAlign(mTb[1]) }, end, warnings: [], shape: lastGridShape }
  }
  const mTab = RE_TAB_START.exec(trimmed)
  if (mTab) {
    const { body, end } = scanEnvBody(lines, start, RE_TAB_END)
    return { block: { kind: 'tab', text: body.join('\n'), label: readLabel(mTab[1]) }, end, warnings: [], shape: lastGridShape }
  }
  const mGrid = RE_GRID_START.exec(trimmed)
  if (mGrid) return readGridBlock(lines, start, mGrid[1], lastGridShape)
  return null
}

// Resolve a single-line directive that emits (or deliberately drops) one block:
// {image}, the inline display-only {chord}, and styled {comment_*}. A non-null
// outer result means the line was consumed even when `block` is null (e.g. an
// image with a missing/non-http src is dropped, not pushed into a chordpro run).
// {chord} is inline and display-only — it does NOT register a shape (that's
// {define}); parseChordDefinition is hoisted (declared below).
function readInlineDirective(trimmed: string): { block: DocBlock | null } | null {
  const mImg = RE_IMAGE.exec(trimmed)
  if (mImg) {
    const raw = readAttr(mImg[1], 'src')
    const src = raw ? safeImageSrc(raw) : null
    if (!src) return { block: null }
    return { block: { kind: 'image', src, anchored: /anchor\s*=\s*["']?page/i.test(mImg[1]), scale: readAttr(mImg[1], 'scale') } }
  }
  const mChord = RE_CHORD_INLINE.exec(trimmed)
  if (mChord) {
    const parsed = parseChordDefinition(mChord[1])
    if (!parsed) return { block: null }
    const nm = (parsed.display ?? parsed.name).replace(/^\[|\]$/g, '')
    return { block: { kind: 'chorddef', name: nm, shape: parsed.shape ?? lookupGuitarChord(nm) } }
  }
  const mComment = RE_COMMENT_STYLED.exec(trimmed)
  if (mComment) {
    const variant = /^(comment_box|cb)$/i.test(mComment[1]) ? 'box' : 'italic'
    return { block: { kind: 'comment', text: mComment[2].trim(), variant } }
  }
  return null
}

// Mutable accumulator threaded through the per-line parse so each line handler
// can append blocks/warnings and carry forward the column count, the last grid
// shape (reused by a later grid that omits its shape), and the pending plain-line
// buffer.
interface ParseState {
  blocks: DocBlock[]
  warnings: string[]
  columns: number
  lastGridShape: string | null
  buf: string[]
}

// Emit the buffered plain lines as one chordpro block (skipping a buffer that is
// only blank lines) and reset the buffer.
function flushBuf(state: ParseState): void {
  if (state.buf.some((l) => l.trim() !== '')) state.blocks.push({ kind: 'chordpro', source: state.buf.join('\n') })
  state.buf = []
}

// Process the line at `i`, mutating `state`, and return the index of the next
// line to process (past a consumed block environment, or `i + 1`).
function consumeLine(lines: string[], i: number, state: ParseState): number {
  const trimmed = lines[i].trim()

  const mCols = RE_COLUMNS.exec(trimmed)
  if (mCols) { state.columns = Math.max(1, Number(mCols[1] || 2)); return i + 1 }
  if (RE_DIAGRAMS.test(trimmed)) return i + 1 // chord-diagram grid not rendered yet
  if (RE_COLB.test(trimmed)) { flushBuf(state); state.blocks.push({ kind: 'colb' }); return i + 1 }

  const env = readEnvironment(lines, i, trimmed, state.lastGridShape)
  if (env) {
    flushBuf(state)
    state.blocks.push(env.block)
    state.warnings.push(...env.warnings)
    state.lastGridShape = env.shape
    return env.end + 1
  }

  const inline = readInlineDirective(trimmed)
  if (inline) {
    flushBuf(state)
    if (inline.block) state.blocks.push(inline.block)
    return i + 1
  }

  // Hoist metadata directives to the header (rendered separately); dropping them
  // here keeps ChordSheetJS from re-printing the title/subtitle.
  if (parseMetaLine(trimmed)) return i + 1

  state.buf.push(lines[i])
  return i + 1
}

// Split a raw ChordPro file into ordered, renderable blocks. Consecutive plain
// lines accumulate into a 'chordpro' block; the special directives interrupt and
// emit their own block. The directives we render specially are stripped from the
// chordpro runs so ChordSheetJS doesn't mangle them (it turns {image} into a
// broken <img> and shows directive attributes as stray labels).
export function parseChordProDocument(source: string): ChordProDocument {
  const lines = (source ?? '').replace(/\r\n?/g, '\n').split('\n')
  const state: ParseState = { blocks: [], warnings: [], columns: 1, lastGridShape: null, buf: [] }
  let i = 0
  while (i < lines.length) i = consumeLine(lines, i, state)
  flushBuf(state)
  return { columns: state.columns, blocks: state.blocks, warnings: state.warnings }
}

// A grid line is a sequence of bar-line symbols and the cells between them.
// Everything before the first bar is the left margin; everything after the last
// bar is the right margin; a line with no bar at all is wholly left-margin.
const RE_GRID_BARLINE = /^(?::\|:|:\|\d*>?|\|:|\|\||\|\.|\|\d+>?|\|)$/

export type GridCell =
  | { kind: 'chord'; text: string }
  | { kind: 'repeat'; measures: 1 | 2 } // % (this measure) / %% (last two measures)
  | { kind: 'slash' }                   // / — beat to be strummed/played
  | { kind: 'empty' }                   // . — blank beat
  | { kind: 'text'; text: string }      // strum pseudo-chords (dn/up/…) and anything else
export type GridToken =
  | { kind: 'bar'; text: string }
  | { kind: 'cell'; cell: GridCell }
export interface ParsedGridLine { marginLeft: string; tokens: GridToken[]; marginRight: string }

export interface GridShape { left: number; measures: number; beats: number; right: number }

// `[L+]MxB[+R]` (e.g. `1+4x2+4`) or a bare cell count (`16`). The cells-only form
// carries no margins and is treated as one measure of N beats (so its bar
// estimate stays minimal — `16` is 16 cells in one bar group, not 16 measures).
const RE_GRID_SHAPE = /^(?:(\d+)\+)?(\d+)x(\d+)(?:\+(\d+))?$/
const RE_GRID_SHAPE_CELLS = /^\d+$/

// True for any shape string parseGridShape understands (used to surface a warning
// for unrecognized shapes rather than silently defaulting).
export function isValidGridShape(shape: string): boolean {
  const s = shape.trim()
  return RE_GRID_SHAPE.test(s) || RE_GRID_SHAPE_CELLS.test(s)
}

// Parse a grid `shape`. Default per spec when unset/invalid: 1+4x4+1.
export function parseGridShape(shape: string | null): GridShape {
  const s = (shape ?? '').trim()
  const m = RE_GRID_SHAPE.exec(s)
  if (m) return { left: Number(m[1] ?? 1), measures: Number(m[2]), beats: Number(m[3]), right: Number(m[4] ?? 1) }
  if (RE_GRID_SHAPE_CELLS.test(s)) return { left: 0, measures: 1, beats: Number(s), right: 0 }
  return { left: 1, measures: 4, beats: 4, right: 1 }
}

// Transpose the chord(s) in a grid cell by `semitones`. A multi-chord cell
// (`C~A`) transposes each chord around the `~` separator; unparseable tokens
// (strum marks, etc.) pass through unchanged.
export function transposeGridChord(text: string, semitones: number): string {
  if (!semitones) return text
  return text.split('~').map((part) => Chord.parse(part)?.transpose(semitones)?.toString() ?? part).join('~')
}

// Validate measure-repeat usage on a grid line: `%`/`%%` expect the rest of the
// affected measure(s) to be blank. Returns a warning per offending line.
function gridLineWarnings(line: string): string[] {
  const { tokens } = parseGridLine(line)
  const measures: GridCell[][] = []
  let cur: GridCell[] | null = null
  for (const t of tokens) {
    if (t.kind === 'bar') { if (cur) measures.push(cur); cur = []; continue }
    cur?.push(t.cell)
  }
  if (cur && cur.length) measures.push(cur)

  const hasContent = (cells: GridCell[]) => cells.some((c) => c.kind === 'chord' || c.kind === 'slash' || c.kind === 'text')
  const out: string[] = []
  measures.forEach((m, idx) => {
    const repeat = m.find((c): c is { kind: 'repeat'; measures: 1 | 2 } => c.kind === 'repeat')
    if (!repeat) return
    if (hasContent(m)) out.push(`Repeat-measure symbol expects the rest of the measure to be blank: "${line.trim()}"`)
    if (repeat.measures === 2) {
      const next = measures[idx + 1]
      if (next && (hasContent(next) || next.some((c) => c.kind === 'repeat'))) {
        out.push(`%% repeats the previous two measures; the following measure should be blank: "${line.trim()}"`)
      }
    }
  })
  return out
}

function classifyGridCell(token: string): GridCell {
  if (token === '%') return { kind: 'repeat', measures: 1 }
  if (token === '%%') return { kind: 'repeat', measures: 2 }
  if (token === '.') return { kind: 'empty' }
  if (token === '/') return { kind: 'slash' }
  if (/^[A-G1-7]/.test(token)) return { kind: 'chord', text: token }
  return { kind: 'text', text: token }
}

// The body of a grid row laid out by measure: bars as separators, a `flat`
// measure renders its cells at beat positions, a `repeat` is a single centered
// simile glyph spanning `cells` beat-columns.
export type GridRenderItem =
  | { kind: 'bar'; text: string }
  // A centered simile spanning `cells` beat-columns plus `bars` absorbed bar
  // widths (a merged `%%` keeps the space of the bar it dropped, so the columns
  // after it stay aligned with the other rows).
  | { kind: 'repeat'; measures: 1 | 2; cells: number; bars: number }
  | { kind: 'flat'; cells: GridCell[] }

// A measure is a "pure repeat" when its only non-empty cell is a single `%`/`%%`
// (everything else blank); those center across the measure. Anything else (a
// chord, a second symbol) lays its cells out at beat positions instead.
export function measureRepeat(cells: GridCell[]): 1 | 2 | null {
  let rep: 1 | 2 | null = null
  let count = 0
  for (const c of cells) {
    if (c.kind === 'repeat') { rep = c.measures; count++ }
    else if (c.kind !== 'empty') return null
  }
  return count === 1 ? rep : null
}

// Group a parsed body (bars + cells) into measures for rendering. A `%` measure
// centers across its own beats; a `%%` measure merges with the following measure
// — dropping the bar between them — and centers across the pair (matching the
// official renderer). The closing bar is always kept.
export function buildGridItems(tokens: GridToken[]): GridRenderItem[] {
  const measures: GridCell[][] = []
  const bars: string[] = []
  let cur: GridCell[] | null = null
  for (const t of tokens) {
    if (t.kind === 'bar') { if (cur) measures.push(cur); bars.push(t.text); cur = [] }
    else cur?.push(t.cell)
  }
  if (bars.length === 0) return []

  const items: GridRenderItem[] = []
  let mi = 0
  while (mi < measures.length) {
    items.push({ kind: 'bar', text: bars[mi] })
    const m = measures[mi]
    const rep = measureRepeat(m)
    if (rep === 2 && mi + 1 < measures.length) {
      // Consume this + the next measure; the bar between them (bars[mi+1]) is
      // dropped visually but its width is kept so later columns stay aligned.
      items.push({ kind: 'repeat', measures: 2, cells: m.length + measures[mi + 1].length, bars: 1 })
      mi += 2
    } else if (rep) {
      items.push({ kind: 'repeat', measures: rep, cells: m.length, bars: 0 })
      mi += 1
    } else {
      items.push({ kind: 'flat', cells: m })
      mi += 1
    }
  }
  items.push({ kind: 'bar', text: bars[bars.length - 1] })
  return items
}

// ---------- voltas / endings ----------

// Numeric em widths of a beat-cell and a bar slot, so volta bracket offsets can
// be computed in the same units the grid renders in.
const GRID_CELL_EM = parseFloat(GRID_CELL_W)
const GRID_BAR_EM = parseFloat(GRID_BAR_W)

export interface VoltaInfo { number: number; aligned: boolean }
export interface VoltaSpan { number: number; aligned: boolean; startEm: number; endEm: number }

// A volta / ending bar: `|1` (first ending), `:|2` (second ending) and the `>`
// variant `:|2>` that asks to align this ending under the previous line's first
// ending. Returns null for any non-volta bar.
const RE_VOLTA_BAR = /^:?\|(\d+)(>?)$/
// Bars that terminate a volta bracket: repeat-close, double bar, final bar.
const RE_VOLTA_CLOSE = /^(?::\|:|:\||\|\||\|\.)$/

export function voltaInfo(barText: string): VoltaInfo | null {
  const m = RE_VOLTA_BAR.exec(barText)
  return m ? { number: Number(m[1]), aligned: m[2] === '>' } : null
}

function gridItemWidthEm(it: GridRenderItem): number {
  if (it.kind === 'bar') return GRID_BAR_EM
  if (it.kind === 'repeat') return it.cells * GRID_CELL_EM + it.bars * GRID_BAR_EM
  return it.cells.length * GRID_CELL_EM
}

// Compute the volta bracket spans of a rendered row as em offsets from the body's
// left edge. A bracket opens on a `|N`/`:|N` bar and runs until the next
// repeat-close/double/final bar, the next volta open, or the end of the row;
// `endEm` is the left edge of that closing bar so the bracket's right hook lands
// on it. The viewer draws a `number.` bracket across each span (and shifts an
// `aligned` ending so it sits under the previous line's first ending).
export function buildVoltaSpans(items: GridRenderItem[]): VoltaSpan[] {
  const spans: VoltaSpan[] = []
  let open: { number: number; aligned: boolean; startEm: number } | null = null
  let x = 0
  const close = (endEm: number) => { if (open) { spans.push({ ...open, endEm }); open = null } }
  for (const it of items) {
    if (it.kind === 'bar') {
      const v = voltaInfo(it.text)
      if (v) { close(x); open = { number: v.number, aligned: v.aligned, startEm: x } }
      else if (RE_VOLTA_CLOSE.test(it.text)) close(x)
    }
    x += gridItemWidthEm(it)
  }
  close(x)
  return spans
}

// Split a grid line into left margin / body (bars + cells) / right margin.
export function parseGridLine(line: string): ParsedGridLine {
  const tokens = line.trim().split(/\s+/).filter(Boolean)
  const barPositions = tokens.flatMap((t, i) => (RE_GRID_BARLINE.test(t) ? [i] : []))
  if (barPositions.length === 0) return { marginLeft: tokens.join(' '), tokens: [], marginRight: '' }
  const first = barPositions[0]
  const last = barPositions[barPositions.length - 1]
  const body: GridToken[] = tokens.slice(first, last + 1).map((t) =>
    RE_GRID_BARLINE.test(t) ? { kind: 'bar', text: t } : { kind: 'cell', cell: classifyGridCell(t) })
  return { marginLeft: tokens.slice(0, first).join(' '), tokens: body, marginRight: tokens.slice(last + 1).join(' ') }
}

// ---------- chord diagrams ----------

export type DiagramsPlacement = 'top' | 'bottom' | 'off'
export interface ResolvedChord { name: string; shape: ChordShape | null }
export interface ChordAnalysis { placement: DiagramsPlacement; chords: ResolvedChord[] }

// Only {define} registers a reusable shape for the grid; {chord} is inline-only
// (handled in parseChordProDocument) and must not override the grid.
const RE_DEFINE = /^\{define\b[:\s]+(.+)\}$/i
const RE_DIAGRAMS_VAL = /^\{diagrams\b[:\s]*([a-z]*)\}/i
const DEFINE_KEYWORDS = new Set(['base-fret', 'base_fret', 'basefret', 'frets', 'fingers', 'keys', 'display', 'format', 'diagram', 'copy', 'copyall'])

function parseFret(tok: string): number {
  if (/^(x|n|-1)$/i.test(tok)) return -1
  const n = Number(tok)
  return Number.isInteger(n) ? n : -1
}

function parseFinger(tok: string): number {
  const n = Number(tok)
  return Number.isInteger(n) && n > 0 ? n : 0 // letters/0 → ignored
}

// Parse a {define}/{chord} argument string into a name + shape (or null shape
// when no frets/keys are given — a properties-only definition). See the spec at
// chordpro.org/chordpro/directives-define. Stops at sub-directives we don't
// render (display/format/diagram/copy).
export function parseChordDefinition(arg: string): { name: string; shape: ChordShape | null; display?: string } | null {
  const tokens = arg.trim().split(/\s+/)
  if (!tokens.length || !tokens[0]) return null
  const name = tokens[0]
  let baseFret = 1
  let frets: number[] | undefined
  let fingers: number[] | undefined
  let keys: number[] | undefined
  let display: string | undefined

  let i = 1
  const collect = (map: (t: string) => number): number[] => {
    const arr: number[] = []
    while (i < tokens.length && !DEFINE_KEYWORDS.has(tokens[i].toLowerCase())) { arr.push(map(tokens[i])); i++ }
    return arr
  }

  while (i < tokens.length) {
    const kw = tokens[i].toLowerCase()
    if (kw === 'base-fret' || kw === 'base_fret' || kw === 'basefret') {
      baseFret = Math.max(1, Number(tokens[i + 1]) || 1); i += 2; continue
    }
    if (kw === 'frets') { i++; frets = collect(parseFret); continue }
    if (kw === 'fingers') { i++; fingers = collect(parseFinger); continue }
    if (kw === 'keys') { i++; keys = collect((t) => Number(t)).filter((n) => Number.isFinite(n)); continue }
    if (kw === 'display') { display = tokens[i + 1]; i += 2; continue }
    break // format/diagram/copy — not rendered
  }

  const shape: ChordShape | null = (frets?.length || keys?.length)
    ? { baseFret, frets: frets ?? [], fingers, keys }
    : null
  const result: { name: string; shape: ChordShape | null; display?: string } = { name, shape }
  if (display) result.display = display
  return result
}

// Collect the chord-diagram grid for a song: the {diagrams} placement, every
// distinct chord used in [brackets] (first-appearance order), and each resolved
// to a shape — a song's own {define}/{chord} overrides the built-in library.
type ChordDefs = Record<string, { shape: ChordShape; display: string | null }>

// Scan a song for its {diagrams} placement directive and every {define}/{chord}
// custom shape, which override the built-in library in the grid.
function collectDefsAndPlacement(text: string): { defs: ChordDefs; placement: DiagramsPlacement } {
  const defs: ChordDefs = {}
  let placement: DiagramsPlacement = 'bottom'
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = line.trim()
    const md = RE_DIAGRAMS_VAL.exec(trimmed)
    if (md) {
      const v = (md[1] || 'on').toLowerCase()
      placement = v === 'off' ? 'off' : v === 'top' ? 'top' : 'bottom'
      continue
    }
    const mDef = RE_DEFINE.exec(trimmed)
    if (mDef) {
      const parsed = parseChordDefinition(mDef[1])
      if (parsed?.shape) defs[parsed.name] = { shape: parsed.shape, display: parsed.display ?? null }
    }
  }
  return { defs, placement }
}

export function analyzeChords(source: string, transposeOffset = 0): ChordAnalysis {
  const text = source ?? ''
  const { defs, placement } = collectDefsAndPlacement(text)

  // Transpose the grid's chord names by the same amount as the lyrics so the
  // diagrams match what's printed above the words.
  const transpose = getTransposeAmount(text) + transposeOffset
  const transposeName = (name: string): string =>
    transpose ? (Chord.parse(name)?.transpose(transpose)?.toString() ?? name) : name

  const chords: ResolvedChord[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(/\[([^*\]][^\]]*)\]/g)) {
    const raw = m[1].trim()
    if (!raw) continue
    const name = transposeName(raw)
    const def = defs[name] ?? defs[raw]
    // {define … display X} shows the custom shape under name X in the grid.
    const label = def?.display ?? name
    if (seen.has(label)) continue
    seen.add(label)
    const shape = def?.shape ?? lookupGuitarChord(name) ?? null
    chords.push({ name: label, shape })
  }
  return { placement, chords }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Standalone stylesheet for the print window. The on-screen viewer mirrors the
// chord colors via `sx` (so it tracks the theme); the structural layout classes
// (cp-*) and the ChordSheetJS classes (.chord/.lyrics/…) are styled here so the
// cloned DOM — including inline abcjs SVGs — prints correctly without the app's
// (emotion) stylesheet.
export const CHORDPRO_PRINT_CSS = `
  * { box-sizing: border-box; }
  body { margin: 0.6in; color: #000; background: #fff;
    font-family: "Helvetica Neue", Arial, sans-serif; font-size: 12pt; }
  h1.title { font-size: 20pt; margin: 0 0 0.1em; }
  h2.subtitle, .artist { font-size: 13pt; font-weight: 400; color: #444; margin: 0 0 0.6em; }
  .cp-meta { margin: 0 0 1em; }
  .cp-meta-title { font-size: 20pt; font-weight: 700; }
  .cp-meta-subtitle { font-size: 13pt; color: #444; }
  .cp-meta-info { font-size: 10pt; color: #444; margin-top: 0.2em; }
  .cp-meta-info b { color: #000; font-weight: 700; }
  .cp-comment { margin: 0.4em 0; }
  .cp-comment.box { border: 1px solid #888; border-radius: 4px; padding: 0.2em 0.6em; display: inline-block; }
  .cp-comment.italic { font-style: italic; color: #555; }
  .cp-tab { margin: 0 0 1em; }
  .cp-tab-label { font-size: 9pt; font-weight: 700; color: #444; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 0.3em; }
  .cp-tab pre { margin: 0; font-family: ${MONO_FONT}; white-space: pre; line-height: 1.3; font-variant-ligatures: none; overflow-x: auto; }
  .cp-chorddef { display: inline-block; vertical-align: top; margin: 0 16px 8px 0; }
  .cp-grid { margin: 0 0 1em; font-family: ${MONO_FONT}; font-variant-ligatures: none; }
  .cp-grid-label { font-size: 9pt; font-weight: 700; color: #444; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 0.3em; }
  .cp-grow { display: flex; align-items: center; min-height: 1.6em; }
  .cp-gmargin { flex: none; padding-right: 8px; display: flex; align-items: center; }
  .cp-glabel { background: #e8e8e8; border-radius: 3px; padding: 1px 6px; font-weight: 600; font-size: 0.9em; white-space: nowrap; }
  .cp-gright { padding-left: 8px; color: #000; white-space: nowrap; }
  .cp-gchord { color: #000; font-weight: 700; }
  .chord sup, .cp-gchord sup { font-size: 0.7em; line-height: 0; vertical-align: super; }
  .cp-gbar { color: #1565c0; font-weight: 700; }
  .cp-gbar-repeat { color: #6a1b9a; }
  .cp-warnings { border: 1px solid #b26a00; color: #b26a00; border-radius: 4px; padding: 6px 8px; margin: 0 0 1em; font-size: 10pt; }
  .cp-abc { margin: 0 0 1em; }
  .cp-abc svg { max-width: 100%; height: auto; }
  .cp-columns { display: flex; gap: 24px; align-items: flex-start; }
  .cp-column { flex: 1; min-width: 0; }
  .cp-textblock { white-space: pre-wrap; }
  .cp-anchored-images { text-align: right; margin-top: 1rem; }
  .cp-anchored-images img { max-width: 50%; height: auto; }
  .cp-diagrams-collapsible { display: none; }
  .cp-diagrams-print { display: block; }
  .cp-diagrams { display: flex; flex-wrap: wrap; gap: 16px; justify-content: center; margin: 0 0 1em; }
  .cp-diagram { text-align: center; font-size: 9pt; color: #000; }
  .cp-diagram > div:first-child { font-weight: 700; color: #1565c0; }
  .cp-diagram svg { display: block; margin: 0 auto; }
  .chord-sheet { line-height: 1.1; }
  .paragraph { margin-bottom: 1em; break-inside: avoid; }
  .paragraph.chorus { border-left: 3px solid #888; padding-left: 0.75em; }
  .paragraph.bridge { border-left: 3px dotted #888; padding-left: 0.75em; }
  .literal { font-family: ${MONO_FONT}; white-space: pre; line-height: 1.3; font-variant-ligatures: none; }
  .label { font-size: 9pt; font-weight: 700; color: #444; margin: 0 0 0.3em; text-transform: uppercase; letter-spacing: 0.03em; }
  .row { display: flex; flex-wrap: wrap; }
  .column { display: flex; flex-direction: column; }
  .chord { font-weight: 700; color: #1565c0; white-space: pre; }
  .chord:not(:last-child) { padding-right: 10px; }
  .chord:after, .lyrics:after { content: '\\200b'; }
  .lyrics { white-space: pre; }
  .comment { font-style: italic; color: #555; margin: 0.4em 0; }
`

// Print already-rendered chart HTML (cloned from the live DOM, so inline abcjs
// SVGs come along) in an isolated window — which doubles as "Save as PDF". When
// no rendered HTML is available, fall back to rendering plain source.
export function printChordPro(renderedHtml: string | null, source: string, title: string): void {
  const body = renderedHtml || renderChordProHtml(source, getTransposeAmount(source)) || `<pre>${escapeHtml(source ?? '')}</pre>`
  const win = window.open('', '_blank')
  if (!win) return // popup blocked
  win.opener = null
  win.document.write(
    `<!doctype html><html><head><meta charset="utf-8">` +
      `<title>${escapeHtml(title || 'Chart')}</title>` +
      `<style>${CHORDPRO_PRINT_CSS}</style></head><body>${body}</body></html>`,
  )
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 200)
}
