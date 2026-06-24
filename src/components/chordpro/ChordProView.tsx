import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import Box from '@mui/material/Box'
import Collapse from '@mui/material/Collapse'
import ButtonBase from '@mui/material/ButtonBase'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { parseChordProDocument, renderChordProHtml, analyzeChords, getTransposeAmount, extractMetadata, parseGridLine, parseGridShape, transposeGridChord, buildGridItems, voltaInfo, buildVoltaSpans, GRID_CELL_W, GRID_BAR_W, MONO_FONT } from '../../utils/chordpro.ts'
import type { DocBlock, GridCell, GridRenderItem, ParsedGridLine, ResolvedChord, SongMeta, VoltaSpan } from '../../utils/chordpro.ts'
import AbcBlock from '../AbcBlock.tsx'
import ChordDiagram from './ChordDiagram.tsx'
import ChordName from './ChordName.tsx'

// Renders ChordPro source as a laid-out document: embedded ABC blocks engraved
// as staves (AbcBlock), chords-over-lyrics runs via ChordSheetJS (sanitized and
// {transpose}-applied), multi-column flow split at {colb}, aligned text blocks,
// and page-anchored images floated bottom-right (mirroring the official
// renderer). The `sx` chord colors track the theme; structural cp-* classes and
// inline image styles also carry to print.
interface ChordProViewProps {
  source: string
  // Interactive transpose from the viewer's ▲/▼ controls, summed on top of any
  // {transpose} directives in the source (so the on-screen key shifts without
  // editing the chart).
  transposeOffset?: number
}

interface AnchoredImage { src: string; scale: string | null }

// Mirrors CHORDPRO_PRINT_CSS but with theme colors so the screen tracks light/dark.
const chordSheetSx = {
  '& .title': { fontSize: '1.5rem', fontWeight: 700, m: 0, mb: 0.25 },
  '& .subtitle, & .artist': { fontSize: '1rem', fontWeight: 400, color: 'text.secondary', m: 0, mb: 1 },
  '& .chord-sheet': { lineHeight: 1.15 },
  '& .paragraph': { mb: 2, breakInside: 'avoid' },
  '& .paragraph.chorus': { borderLeft: '3px solid', borderColor: 'divider', pl: 1.5 },
  '& .paragraph.bridge': { borderLeft: '3px dotted', borderColor: 'divider', pl: 1.5 },
  // {start_of_tab}: ChordSheetJS emits .literal lines — keep them in the fixed
  // Consolas stack so the tab columns line up; .label styles section labels.
  '& .literal': { fontFamily: MONO_FONT, whiteSpace: 'pre', lineHeight: 1.3, fontVariantLigatures: 'none' },
  '& .label': { fontSize: '0.8125rem', fontWeight: 700, m: 0, mb: 0.5, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.03em' },
  '& .row': { display: 'flex', flexWrap: 'wrap' },
  '& .column': { display: 'flex', flexDirection: 'column' },
  '& .chord': { fontWeight: 700, color: 'primary.main', whiteSpace: 'pre', pr: '10px' },
  // Quality/extension raised by superscriptChordCells (Bb⁷⁽ᵇ⁹⁾); line-height:0
  // keeps it from stretching the chord line.
  '& .chord sup': { fontSize: '0.7em', lineHeight: 0, verticalAlign: 'super' },
  '& .lyrics': { whiteSpace: 'pre' },
  // Keep empty chord/lyric cells a full line tall so chords stay above their
  // syllable and lyrics share one baseline (ChordSheetJS's own alignment trick).
  '& .chord:after, & .lyrics:after': { content: '"\\200b"' },
  '& .comment': { fontStyle: 'italic', color: 'text.secondary', my: 0.5 },
} as const

// Apply an {image scale=…} factor as a CSS transform (ChordPro's scale is
// relative to natural size). Inline style so it carries into the print window.
function imageScaleStyle(scale: string | null, origin: string): CSSProperties | undefined {
  if (!scale) return undefined
  const m = scale.trim().match(/^(\d+(?:\.\d+)?)\s*%$/)
  const factor = m ? Number(m[1]) / 100 : Number(scale)
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return undefined
  return { transform: `scale(${factor})`, transformOrigin: origin }
}

function ChordProSegment({ source, transpose }: { source: string; transpose: number }) {
  const html = renderChordProHtml(source, transpose)
  if (html === null) {
    return (
      <Box component="pre" sx={{ m: 0, fontFamily: MONO_FONT, fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {source}
      </Box>
    )
  }
  return <Box sx={chordSheetSx} dangerouslySetInnerHTML={{ __html: html }} />
}

function FlowBlock({ block, transpose }: { block: DocBlock; transpose: number }) {
  if (block.kind === 'chordpro') return <ChordProSegment source={block.source} transpose={transpose} />
  if (block.kind === 'textblock') {
    return (
      <Box className="cp-textblock" sx={{ whiteSpace: 'pre-wrap', textAlign: block.align, mb: 2 }}>
        {block.text}
      </Box>
    )
  }
  if (block.kind === 'image') {
    return (
      <Box
        component="img"
        src={block.src}
        alt=""
        style={imageScaleStyle(block.scale, 'top left')}
        sx={{ maxWidth: '100%', height: 'auto', mb: 2 }}
      />
    )
  }
  if (block.kind === 'comment') {
    return (
      <Box
        className={`cp-comment ${block.variant}`}
        sx={block.variant === 'box'
          ? { display: 'inline-block', border: '1px solid', borderColor: 'divider', borderRadius: 1, px: 0.75, py: 0.25, my: 0.5, fontWeight: 600 }
          : { fontStyle: 'italic', color: 'text.secondary', my: 0.5 }}
      >
        {block.text}
      </Box>
    )
  }
  if (block.kind === 'tab') {
    return (
      <Box className="cp-tab" sx={{ mb: 2 }}>
        {block.label && (
          <Box className="cp-tab-label" sx={{ fontSize: '0.8125rem', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.03em', mb: 0.5 }}>
            {block.label}
          </Box>
        )}
        <Box component="pre" sx={{ m: 0, fontFamily: MONO_FONT, fontSize: 14, lineHeight: 1.3, whiteSpace: 'pre', overflowX: 'auto', fontVariantLigatures: 'none' }}>
          {block.text}
        </Box>
      </Box>
    )
  }
  if (block.kind === 'chorddef') {
    return (
      <Box className="cp-chorddef" sx={{ display: 'inline-block', verticalAlign: 'top', mr: 2, mb: 1 }}>
        <ChordDiagram name={block.name} shape={block.shape} />
      </Box>
    )
  }
  if (block.kind === 'grid') return <GridBlock lines={block.lines} label={block.label} shape={block.shape} transpose={transpose} />
  return null
}

// Measure-repeat glyph (the "simile" mark): a diagonal stroke flanked by two dots.
// `%%` (repeat the last two measures) carries a small superscript "2", per the
// usual engraving convention. Drawn with currentColor so it tracks the cell color
// on screen and in the cloned print DOM alike.
function GridRepeat({ measures }: { measures: 1 | 2 }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1 }}>
      {measures === 2 && <Box component="span" sx={{ fontSize: '0.65em', fontWeight: 700, mb: '-0.15em' }}>2</Box>}
      <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true" focusable="false">
        <line x1="3" y1="13" x2="11" y2="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="4.6" cy="5" r="1.4" fill="currentColor" />
        <circle cx="9.4" cy="11" r="1.4" fill="currentColor" />
      </svg>
    </Box>
  )
}

// Final barline (`|.`): a thin stroke followed by a thick stroke — the engraving
// convention for the end of a piece/section. Drawn with currentColor so it tracks
// the bar color on screen and in the cloned print DOM alike.
function GridEndBar() {
  return (
    <Box component="span" aria-hidden="true" sx={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
      <Box component="span" sx={{ width: '1.5px', height: '1.1em', bgcolor: 'currentColor' }} />
      <Box component="span" sx={{ width: '3.5px', height: '1.1em', bgcolor: 'currentColor' }} />
    </Box>
  )
}

// A fixed-width beat-cell. `.` renders blank (it only reserves the column so the
// next chord lines up); chords are left-aligned at the start of the measure.
const gridCellStyle = { display: 'inline-flex', alignItems: 'center', width: GRID_CELL_W, flex: 'none' } as const
function GridCellView({ cell, transpose }: { cell: GridCell; transpose: number }) {
  if (cell.kind === 'chord') {
    // Transpose with the song, and split a multi-chord cell (`C~A`) into two
    // chords sharing the one cell.
    const parts = transposeGridChord(cell.text, transpose).split('~')
    return (
      <Box component="span" className="cp-gchord" style={gridCellStyle} sx={{ fontWeight: 700, color: 'text.primary' }}>
        {parts.map((p, i) => <Box component="span" key={i} sx={i > 0 ? { ml: 0.5 } : undefined}><ChordName name={p} /></Box>)}
      </Box>
    )
  }
  if (cell.kind === 'repeat') {
    return <Box component="span" className="cp-gchord" style={gridCellStyle} sx={{ color: 'text.primary' }}><GridRepeat measures={cell.measures} /></Box>
  }
  if (cell.kind === 'slash') {
    return <Box component="span" className="cp-gchord" style={gridCellStyle} sx={{ color: 'text.primary' }}>/</Box>
  }
  if (cell.kind === 'text') {
    return <Box component="span" style={gridCellStyle}>{cell.text}</Box>
  }
  return <Box component="span" style={gridCellStyle} /> // empty
}

// Repeat/section bar lines (`|:` `:|` `:|:` `|.` and voltas) carry a colon, dot,
// or volta number — render them in a distinct accent so they read apart from a
// plain measure bar.
const isRepeatBar = (text: string) => /[:.]/.test(text) || /\d/.test(text)

// A volta bar (`|1`, `:|2`, `:|2>`) renders only its barline stroke — the ending
// number moves to the bracket drawn beneath the row, so the bar shows `|` or `:|`.
const voltaBarGlyph = (text: string) => (text.startsWith(':') ? ':|' : '|')

const labelPillSx = { bgcolor: 'action.hover', borderRadius: 0.75, px: 0.75, py: '1px', fontWeight: 600, fontSize: '0.9em', whiteSpace: 'nowrap' } as const

// The bracket + ending number drawn beneath a row that carries voltas. Each span
// is positioned by em offset from the body's left edge (already including any
// alignment shift), so a `:|2>` ending lands under the previous line's first
// ending. The bracket's horizontal stroke sits on top with hooks dropping toward
// the measures above; the `N.` label rides the top-left corner.
function VoltaBracketRow({ spans, leftWidth, bodyMinWidth }: { spans: VoltaSpan[]; leftWidth: string; bodyMinWidth: string }) {
  return (
    <Box className="cp-grow cp-gvolta" sx={{ display: 'flex', alignItems: 'flex-start', minHeight: '1.1em' }}>
      {/* Mirror cp-gmargin's box (width + 8px right padding, same box-sizing) so the bracket origin lines up with the body. */}
      <Box style={{ flex: 'none', width: leftWidth, paddingRight: '8px' }} />
      <Box style={{ position: 'relative', flex: 'none', minWidth: bodyMinWidth, height: '0.9em' }}>
        {spans.map((s, i) => (
          <Box
            key={i}
            component="span"
            className="cp-gvbracket"
            sx={{ position: 'absolute', top: 0, left: `${s.startEm}em`, width: `${s.endEm - s.startEm}em`, height: '0.7em', borderTop: '2px solid', borderLeft: '2px solid', borderRight: '2px solid', borderColor: 'secondary.main', boxSizing: 'border-box' }}
          >
            <Box component="span" sx={{ position: 'absolute', top: '-0.6em', left: '3px', px: '2px', fontSize: '0.7em', fontWeight: 700, lineHeight: 1, color: 'secondary.main', bgcolor: 'background.paper' }}>{s.number}.</Box>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

interface GridRowProps {
  parsed: ParsedGridLine
  items: GridRenderItem[]
  spans: VoltaSpan[]
  shiftEm: number
  leftWidth: string
  transpose: number
  bodyMinWidth: string
  rightWidth?: string
  blockLabel?: string | null
}

// One grid row: the left margin (the grid's `label` on the first row, plus any
// per-line left-margin text), the bar/cell body, then the right margin. The body
// reserves `bodyMinWidth` so short lines pad out to the shape's rectangle and
// their right margins line up; the right margin reserves `rightWidth` when the
// shape defines right cells. An aligned (`:|N>`) ending shifts the whole body
// right by `shiftEm` so it sits under the previous line's first ending. Volta
// brackets, when present, are drawn on a thin row beneath.
function GridRow({ parsed, items, spans, shiftEm, leftWidth, transpose, bodyMinWidth, rightWidth, blockLabel }: GridRowProps) {
  const { marginLeft, marginRight } = parsed
  if (items.length === 0 && !marginLeft && !blockLabel) return <Box className="cp-grow" sx={{ minHeight: '1.6em' }} />
  // The closing barline of the line is flush-right so a final `||`/`:|`/`|.` lines
  // up on the right with the single `|` that closes the other rows; every other
  // bar is flush-left so first strokes share a column.
  const lastIdx = items.length - 1
  return (
    <Box className="cp-grow-wrap" sx={{ display: 'flex', flexDirection: 'column' }}>
      <Box className="cp-grow" sx={{ display: 'flex', alignItems: 'center', minHeight: '1.6em' }}>
        <Box className="cp-gmargin" style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 'none', paddingRight: '8px', width: leftWidth }}>
          {blockLabel && (
            <Box component="span" className="cp-glabel cp-glabel-name" sx={labelPillSx}>{blockLabel}</Box>
          )}
          {marginLeft && (
            <Box component="span" className="cp-glabel" sx={labelPillSx}>{marginLeft}</Box>
          )}
        </Box>
        <Box className="cp-gbody" style={{ display: 'inline-flex', alignItems: 'center', flex: 'none', minWidth: bodyMinWidth }}>
          {shiftEm > 0 && <Box component="span" style={{ width: `${shiftEm}em`, flex: 'none' }} />}
          {items.map((it, i) => {
            if (it.kind === 'bar') {
              const isEnd = it.text === '|.'
              const volta = voltaInfo(it.text)
              const repeat = !isEnd && (isRepeatBar(it.text) || volta !== null)
              const text = volta ? voltaBarGlyph(it.text) : it.text
              return <Box component="span" key={i} className={`cp-gbar${repeat ? ' cp-gbar-repeat' : ''}${isEnd ? ' cp-gbar-end' : ''}`} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: i === lastIdx ? 'flex-end' : 'flex-start', width: GRID_BAR_W, flex: 'none' }} sx={{ color: repeat ? 'secondary.main' : 'primary.main', fontWeight: 700 }}>{isEnd ? <GridEndBar /> : text}</Box>
            }
            if (it.kind === 'repeat') {
              // A `%`/`%%` glyph centered across its measure(s) — including the
              // width of any bar a `%%` merge absorbed, so later columns stay aligned.
              return <Box component="span" key={i} className="cp-gchord cp-grepeat" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: `calc(${it.cells} * ${GRID_CELL_W} + ${it.bars} * ${GRID_BAR_W})`, flex: 'none' }} sx={{ color: 'text.primary' }}><GridRepeat measures={it.measures} /></Box>
            }
            return <Fragment key={i}>{it.cells.map((c, j) => <GridCellView key={j} cell={c} transpose={transpose} />)}</Fragment>
          })}
        </Box>
        {(marginRight || rightWidth) && (
          <Box component="span" className="cp-gright" style={{ flex: 'none', minWidth: rightWidth }} sx={{ pl: marginRight ? 1 : 0, color: 'text.primary', whiteSpace: 'nowrap' }}>{marginRight}</Box>
        )}
      </Box>
      {spans.length > 0 && <VoltaBracketRow spans={spans} leftWidth={leftWidth} bodyMinWidth={bodyMinWidth} />}
    </Box>
  )
}

const cellEm = parseFloat(GRID_CELL_W) // numeric em widths, for comparing row widths
const barEm = parseFloat(GRID_BAR_W)

// Width needed to hold the left-margin pills of the widest row, as a CSS calc
// string. Monospace ⇒ text width is exactly (chars × 1ch); pad in px covers each
// pill's horizontal padding (~12px), the inter-pill gap (4px), the box's right
// padding (8px) and a little breathing room. ~8px/char is only used to pick the
// widest row, not to render it.
function leftMarginCalc(parsed: ParsedGridLine[], label: string | null): string {
  const widest = parsed.reduce((best, p, li) => {
    const parts = [li === 0 ? label : null, p.marginLeft || null].filter(Boolean) as string[]
    const chars = parts.reduce((n, s) => n + s.length, 0)
    const padPx = parts.length * 12 + Math.max(0, parts.length - 1) * 4 + (parts.length ? 14 : 0)
    return chars * 8 + padPx > best.chars * 8 + best.padPx ? { chars, padPx } : best
  }, { chars: 0, padPx: 0 })
  return `calc(${widest.chars}ch + ${widest.padPx}px)`
}

// Scale a fixed-width grid down to fit its container so a wide chart never
// produces a horizontal scrollbar — the careful em-based column alignment is
// preserved, just shrunk uniformly. Transforms don't affect layout, so the
// inner element's offsetWidth/Height always report the unscaled natural size;
// we read those, derive the factor against the container, and set the outer
// height to the scaled height so the transform doesn't leave a gap or clip.
function useFitScale(deps: unknown[]) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [height, setHeight] = useState<number | undefined>(undefined)

  useLayoutEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner) return
    const measure = () => {
      const natW = inner.offsetWidth
      const avail = outer.clientWidth
      const s = natW > avail && avail > 0 ? avail / natW : 1
      setScale(s)
      setHeight(s < 1 ? Math.ceil(inner.offsetHeight * s) : undefined)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(outer)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { outerRef, innerRef, scale, height }
}

interface GridRowLayout { items: GridRenderItem[]; spans: VoltaSpan[]; shiftEm: number }

// Per-row layout items + volta spans, with an alignment pass top-to-bottom: an
// `:|N>` ending shifts right so its bracket starts under the *first* (leftmost)
// volta of the most recent volta-bearing line above it — whatever that ending's
// number is (`|1`, `|2`, …). The shift is folded into each span (and the row's
// body spacer) so the bracket and the pushed body share one origin.
function buildGridRowLayout(parsed: ParsedGridLine[]): GridRowLayout[] {
  const out: GridRowLayout[] = []
  let prevFirstVoltaStartEm: number | null = null
  for (const p of parsed) {
    const items: GridRenderItem[] = buildGridItems(p.tokens)
    const spans: VoltaSpan[] = buildVoltaSpans(items)
    const aligned: VoltaSpan | undefined = spans.find((s) => s.aligned)
    const shiftEm: number = aligned && prevFirstVoltaStartEm !== null ? Math.max(0, prevFirstVoltaStartEm - aligned.startEm) : 0
    const shifted: VoltaSpan[] = spans.map((s) => ({ ...s, startEm: s.startEm + shiftEm, endEm: s.endEm + shiftEm }))
    // Remember this line's leftmost volta (post-shift) so the next `>` aligns under it.
    if (shifted.length > 0) prevFirstVoltaStartEm = shifted[0].startEm
    out.push({ items, spans: shifted, shiftEm })
  }
  return out
}

function GridBlock({ lines, label, shape, transpose }: { lines: string[]; label: string | null; shape: string | null; transpose: number }) {
  const { left, measures, beats, right } = parseGridShape(shape)
  // A grid with a label but no body lines still shows the label row.
  const rows = lines.length > 0 ? lines : ['']
  const parsed = rows.map(parseGridLine)

  // The widest actual row defines the content rectangle (so short lines pad up to
  // it). An explicit/inherited shape additionally floors the body at its
  // measures×beats rectangle (+ a bar per measure boundary); a null shape never
  // forces padding, so unshaped grids stay compact.
  const widest = parsed.reduce((best, p) => {
    const cells = p.tokens.filter((t) => t.kind === 'cell').length
    const bars = p.tokens.filter((t) => t.kind === 'bar').length
    return cells * cellEm + bars * barEm > best.cells * cellEm + best.bars * barEm ? { cells, bars } : best
  }, { cells: 0, bars: 0 })
  const contentCalc = `calc(${widest.cells} * ${GRID_CELL_W} + ${widest.bars} * ${GRID_BAR_W})`
  const shapeCalc = shape !== null ? `calc(${measures * beats} * ${GRID_CELL_W} + ${measures + 1} * ${GRID_BAR_W})` : null
  const bodyMinWidth = shapeCalc ? `max(${shapeCalc}, ${contentCalc})` : contentCalc

  // The left margin must fit the label pill + any per-line left-margin pill, not
  // just the shape's `left` cells (a wide label like "16 cells" on a shape="16"
  // grid would otherwise overflow onto the body). The grid is monospace, so size
  // by character count in `ch`, plus pill padding/gap/box-padding in px, floored
  // by the shape width. One width for the whole block keeps bodies aligned.
  const leftWidth = `max(calc(${left} * ${GRID_CELL_W} + 1.5em), ${leftMarginCalc(parsed, label)})`

  // Reserve a fixed right-margin column only when a row carries right-margin text
  // (per spec: no empty columns unless needed for alignment).
  const anyRight = parsed.some((p) => p.marginRight !== '')
  const rightWidth = right > 0 && anyRight ? `calc(${right} * ${GRID_CELL_W})` : undefined

  const rowLayout = buildGridRowLayout(parsed)

  const { outerRef, innerRef, scale, height } = useFitScale([bodyMinWidth, leftWidth, rightWidth, rows.length, transpose])

  return (
    <Box ref={outerRef} className="cp-grid" sx={{ mb: 2, overflowX: 'hidden', height }}>
      <Box ref={innerRef} className="cp-grid-scale" sx={{ display: 'inline-block', fontFamily: MONO_FONT, fontSize: 14, fontVariantLigatures: 'none', transformOrigin: 'top left', transform: scale < 1 ? `scale(${scale})` : 'none' }}>
        {parsed.map((p, li) => (
          <GridRow key={li} parsed={p} items={rowLayout[li].items} spans={rowLayout[li].spans} shiftEm={rowLayout[li].shiftEm} leftWidth={leftWidth} transpose={transpose} bodyMinWidth={bodyMinWidth} rightWidth={rightWidth} blockLabel={li === 0 ? label : null} />
        ))}
      </Box>
    </Box>
  )
}

function MetaHeader({ meta }: { meta: SongMeta }) {
  if (!meta.title && !meta.subtitle && meta.items.length === 0) return null
  return (
    <Box className="cp-meta" sx={{ mb: 2 }}>
      {meta.title && <Box className="cp-meta-title" sx={{ fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.15 }}>{meta.title}</Box>}
      {meta.subtitle && <Box className="cp-meta-subtitle" sx={{ color: 'text.secondary' }}>{meta.subtitle}</Box>}
      {meta.items.length > 0 && (
        <Box className="cp-meta-info" sx={{ mt: 0.5, color: 'text.secondary', fontSize: 14 }}>
          {meta.items.map((it, idx) => (
            <Box component="span" key={it.key}>
              {idx > 0 && ' · '}
              <Box component="b" sx={{ color: 'text.primary' }}>{it.label === '©' ? '©' : `${it.label}:`}</Box> {it.value}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}

type Section = { type: 'abc'; abc: string } | { type: 'flow'; columns: DocBlock[][] }

// Group blocks into full-width ABC sections and column-flowed sections (split at
// {colb}). Page-anchored images are pulled out to render at the end.
function buildSections(blocks: DocBlock[]): { sections: Section[]; anchoredImages: AnchoredImage[] } {
  const sections: Section[] = []
  const anchoredImages: AnchoredImage[] = []
  let flowColumns: DocBlock[][] = [[]]

  const closeFlow = () => {
    if (flowColumns.some((c) => c.length > 0)) sections.push({ type: 'flow', columns: flowColumns })
    flowColumns = [[]]
  }

  for (const b of blocks) {
    if (b.kind === 'abc') { closeFlow(); sections.push({ type: 'abc', abc: b.abc }); continue }
    if (b.kind === 'image' && b.anchored) { anchoredImages.push({ src: b.src, scale: b.scale }); continue }
    if (b.kind === 'colb') { flowColumns.push([]); continue }
    flowColumns[flowColumns.length - 1].push(b)
  }
  closeFlow()
  return { sections, anchoredImages }
}

function FlowSection({ columns, multiColumn, transpose }: { columns: DocBlock[][]; multiColumn: boolean; transpose: number }) {
  if (!multiColumn || columns.length < 2) {
    return <>{columns.flat().map((b, i) => <FlowBlock key={i} block={b} transpose={transpose} />)}</>
  }
  return (
    <Box className="cp-columns" sx={{ display: 'flex', gap: 3, alignItems: 'flex-start' }}>
      {columns.map((col, ci) => (
        <Box key={ci} className="cp-column" sx={{ flex: 1, minWidth: 0 }}>
          {col.map((b, i) => <FlowBlock key={i} block={b} transpose={transpose} />)}
        </Box>
      ))}
    </Box>
  )
}

function DiagramGrid({ chords }: { chords: ResolvedChord[] }) {
  return (
    <Box className="cp-diagrams" sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2, justifyContent: 'center' }}>
      {chords.map((c, i) => <ChordDiagram key={i} name={c.name} shape={c.shape} />)}
    </Box>
  )
}

// A collapsible header at the top of the view holding the guitar chord diagrams.
// Starts collapsed so the chart stays the focus; the count hints at what's inside.
function CollapsibleDiagrams({ chords }: { chords: ResolvedChord[] }) {
  const [open, setOpen] = useState(false)
  return (
    <Box className="cp-diagrams-collapsible" sx={{ mb: 2 }}>
      <ButtonBase
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        sx={{ display: 'flex', alignItems: 'center', gap: 0.5, width: '100%', justifyContent: 'flex-start', py: 0.5, borderRadius: 1, fontWeight: 600, fontSize: '0.8125rem', textTransform: 'uppercase', letterSpacing: '0.03em', color: 'text.secondary' }}
      >
        <ExpandMoreIcon fontSize="small" sx={{ transition: 'transform 0.2s', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
        Chords ({chords.length})
      </ButtonBase>
      <Collapse in={open} unmountOnExit>
        <DiagramGrid chords={chords} />
      </Collapse>
    </Box>
  )
}

function PrintDiagrams({ chords }: { chords: ResolvedChord[] }) {
  return (
    <Box className="cp-diagrams-print" sx={{ display: 'none' }}>
      <DiagramGrid chords={chords} />
    </Box>
  )
}

export default function ChordProView({ source, transposeOffset = 0 }: ChordProViewProps) {
  const { columns, blocks, warnings } = parseChordProDocument(source)
  const { sections, anchoredImages } = buildSections(blocks)
  const { placement, chords } = analyzeChords(source, transposeOffset)
  const transpose = getTransposeAmount(source) + transposeOffset
  const meta = extractMetadata(source)
  const showGrid = placement !== 'off' && chords.length > 0

  return (
    <Box className="cp-doc">
      <MetaHeader meta={meta} />
      {warnings.length > 0 && (
        <Box className="cp-warnings" sx={{ mb: 2, p: 1, borderRadius: 1, border: '1px solid', borderColor: 'warning.main', color: 'warning.main', fontSize: 13 }}>
          {warnings.map((w, i) => <Box key={i}>⚠ {w}</Box>)}
        </Box>
      )}
      {showGrid && <CollapsibleDiagrams chords={chords} />}
      {chords.length > 0 && <PrintDiagrams chords={chords} />}
      {sections.map((s, i) =>
        s.type === 'abc'
          ? <AbcBlock key={i} abc={s.abc} />
          : <FlowSection key={i} columns={s.columns} multiColumn={columns > 1} transpose={transpose} />,
      )}
      {anchoredImages.length > 0 && (
        <Box className="cp-anchored-images" sx={{ textAlign: 'right', mt: 2, '& img': { maxWidth: '50%', height: 'auto' } }}>
          {anchoredImages.map((img, i) => (
            <Box component="img" key={i} src={img.src} alt="" style={imageScaleStyle(img.scale, 'top right')} />
          ))}
        </Box>
      )}
    </Box>
  )
}
