import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderChordProHtml, parseChordProDocument, safeImageSrc, parseChordDefinition, analyzeChords, getTransposeAmount, extractMetadata, songFieldsFromChordPro, lyricsHtmlFromChordPro, parseGridLine, parseGridShape, isValidGridShape, transposeGridChord, buildGridItems, voltaInfo, buildVoltaSpans, GRID_CELL_W, GRID_BAR_W, printChordPro } from '../utils/chordpro.ts'
import { lookupGuitarChord } from '../utils/guitarChords.ts'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('renderChordProHtml', () => {
  it('renders chords over lyrics with ChordSheetJS classes', () => {
    const html = renderChordProHtml('{title: Twinkle}\n[C]Twinkle [F]little [C]star')
    expect(html).toContain('class="title"')
    expect(html).toContain('class="chord">C</div>')
    expect(html).toContain('Twinkle')
  })

  it('superscripts the chord quality, keeping the root (and minor m) on the baseline', () => {
    expect(renderChordProHtml('[Bb7(b9)]x')).toContain('class="chord">Bb<sup>7(b9)</sup></div>')
    expect(renderChordProHtml('[Cm7]x')).toContain('class="chord">Cm<sup>7</sup></div>')
    // a bare root has nothing to raise
    expect(renderChordProHtml('[C]x')).toContain('class="chord">C</div>')
  })

  it('strips injected scripts/handlers (ChordSheetJS does not escape — DOMPurify must)', () => {
    const html = renderChordProHtml('[C]<img src=x onerror=alert(1)> hi\n{title: <script>alert(2)</script>}')
    expect(html).not.toContain('<script')
    // No tag may carry an event handler; any leftover "onerror" is inert escaped text.
    expect(html).not.toMatch(/<[^>]+\son\w+=/i)
  })

  it('marks a chorus section so the viewer can style it', () => {
    const html = renderChordProHtml('{start_of_chorus}\n[C]la\n{end_of_chorus}')
    expect(html).toContain('chorus')
  })

  it('marks {sob}/{start_of_bridge} as a bridge section, with labels', () => {
    expect(renderChordProHtml('{sob}\n[C]x\n{eob}')).toContain('paragraph bridge')
    const labelled = renderChordProHtml('{start_of_bridge: Bridge 1}\n[C]x\n{end_of_bridge}')
    expect(labelled).toContain('class="label"')
    expect(labelled).toContain('Bridge 1')
  })
})

describe('printChordPro', () => {
  it('writes into the opened window before printing', () => {
    vi.useFakeTimers()
    const win = {
      document: { write: vi.fn(), close: vi.fn() },
      focus: vi.fn(),
      print: vi.fn(),
      opener: {},
    }
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(win)

    printChordPro('<div class="cp-doc">Rendered chart</div>', '[C]fallback', 'Chart title')

    expect(openSpy).toHaveBeenCalledWith('', '_blank')
    expect(win.opener).toBeNull()
    expect(win.document.write.mock.calls[0][0]).toContain('<div class="cp-doc">Rendered chart</div>')
    expect(win.document.close).toHaveBeenCalledTimes(1)
    expect(win.focus).toHaveBeenCalledTimes(1)

    expect(win.print).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(win.print).toHaveBeenCalledTimes(1)
  })
})

describe('parseChordProDocument', () => {
  const MOLLY = [
    '{title: Molly Malone}',
    '{diagrams:top}',
    '{columns:2}',
    '{start_of_abc spread=32 width="700"}',
    'X: 1',
    'K: G',
    '"G"GGG|"Em"G<BG|',
    '{end_of_abc}',
    '{image anchor="page" x="100%" scale="80%" src="https://example.com/molly.jpg"}',
    '{start_of_verse}',
    'She [G]was a fish [Em]monger',
    '{end_of_verse}',
    '{colb}',
    '{start_of_textblock align=right flush=right}',
    'She died of the fever',
    '{end_of_textblock}',
  ].join('\n')

  it('splits ABC, image, verse, colb and textblock into ordered blocks', () => {
    const { columns, blocks } = parseChordProDocument(MOLLY)
    expect(columns).toBe(2)
    // The leading {title} is hoisted to the metadata header, so no title-only
    // chordpro block remains.
    expect(blocks.map((b) => b.kind)).toEqual([
      'abc',
      'image',
      'chordpro', // verse
      'colb',
      'textblock',
    ])
  })

  it('captures the raw ABC body without the wrapping directives', () => {
    const abc = parseChordProDocument(MOLLY).blocks.find((b) => b.kind === 'abc')
    expect(abc.abc).toContain('X: 1')
    expect(abc.abc).toContain('"G"GGG')
    expect(abc.abc).not.toContain('start_of_abc')
  })

  it('parses the image src + page anchor and drops the leaked attributes', () => {
    const img = parseChordProDocument(MOLLY).blocks.find((b) => b.kind === 'image')
    expect(img).toMatchObject({ src: 'https://example.com/molly.jpg', anchored: true, scale: '80%' })
  })

  it('reads textblock alignment', () => {
    const tb = parseChordProDocument(MOLLY).blocks.find((b) => b.kind === 'textblock')
    expect(tb.align).toBe('right')
    expect(tb.text).toContain('She died of the fever')
  })

  it('strips {diagrams} and {columns} from the chordpro runs (no leaked labels)', () => {
    const { blocks } = parseChordProDocument(MOLLY)
    const cp = blocks.filter((b) => b.kind === 'chordpro').map((b) => b.source).join('\n')
    expect(cp).not.toContain('diagrams')
    expect(cp).not.toContain('columns')
  })

  it('rejects non-http(s) image sources', () => {
    expect(safeImageSrc('javascript:alert(1)')).toBeNull()
    expect(safeImageSrc('https://ok.com/a.png')).toBe('https://ok.com/a.png')
  })
})

describe('parseChordProDocument — block boundaries & edge cases', () => {
  it('breaks a plain run wherever a special directive interrupts (ordered chordpro blocks)', () => {
    const { blocks } = parseChordProDocument('[C]line one\n{comment_box: Hey}\n[G]line two')
    expect(blocks.map((b) => b.kind)).toEqual(['chordpro', 'comment', 'chordpro'])
    expect(blocks[0]).toMatchObject({ kind: 'chordpro', source: '[C]line one' })
    expect(blocks[2]).toMatchObject({ kind: 'chordpro', source: '[G]line two' })
  })

  it('does not emit a chordpro block for a run that is only blank lines', () => {
    const { blocks } = parseChordProDocument('{comment_box: A}\n\n\n{comment_box: B}')
    expect(blocks.map((b) => b.kind)).toEqual(['comment', 'comment'])
  })

  it('captures an unclosed ABC block through end-of-file', () => {
    const { blocks } = parseChordProDocument('{start_of_abc}\nX:1\nK:G')
    expect(blocks).toEqual([{ kind: 'abc', abc: 'X:1\nK:G' }])
  })

  it('captures an unclosed textblock through end-of-file', () => {
    const tb = parseChordProDocument('{start_of_textblock}\nlast words').blocks.find((b) => b.kind === 'textblock')
    expect(tb).toEqual({ kind: 'textblock', text: 'last words', align: 'left' })
  })

  it('drops an {image} with no src and one with a non-http(s) src (no image block)', () => {
    expect(parseChordProDocument('{image scale="80%"}').blocks.some((b) => b.kind === 'image')).toBe(false)
    expect(parseChordProDocument('{image src="javascript:alert(1)"}').blocks.some((b) => b.kind === 'image')).toBe(false)
  })

  it('defaults a bare {columns} to 2 and reads {col N}', () => {
    expect(parseChordProDocument('{columns}\n[C]x').columns).toBe(2)
    expect(parseChordProDocument('{col 3}\n[C]x').columns).toBe(3)
    expect(parseChordProDocument('[C]x').columns).toBe(1)
  })

  it('returns empty blocks and no warnings for an empty/whitespace source', () => {
    expect(parseChordProDocument('')).toEqual({ columns: 1, blocks: [], warnings: [] })
    expect(parseChordProDocument('   \n\n  ')).toEqual({ columns: 1, blocks: [], warnings: [] })
  })
})

describe('parseChordDefinition', () => {
  // Verbatim examples from chordpro.org/chordpro/directives-define
  it('parses {define: Bes base-fret 1 frets 1 1 3 3 3 1 fingers 1 1 2 3 4 1}', () => {
    const def = parseChordDefinition('Bes base-fret 1 frets 1 1 3 3 3 1 fingers 1 1 2 3 4 1')
    expect(def).toEqual({ name: 'Bes', shape: { baseFret: 1, frets: [1, 1, 3, 3, 3, 1], fingers: [1, 1, 2, 3, 4, 1], keys: undefined } })
  })

  it('parses {define: As  base-fret 4 frets 1 3 3 2 1 1 fingers 1 3 4 2 1 1} (base-fret 4, double space)', () => {
    const def = parseChordDefinition('As  base-fret 4 frets 1 3 3 2 1 1 fingers 1 3 4 2 1 1')
    expect(def).toEqual({ name: 'As', shape: { baseFret: 4, frets: [1, 3, 3, 2, 1, 1], fingers: [1, 3, 4, 2, 1, 1], keys: undefined } })
  })

  it('extracts both defines from full {define: …} directive lines via analyzeChords', () => {
    const src = [
      '{define: Bes base-fret 1 frets 1 1 3 3 3 1 fingers 1 1 2 3 4 1}',
      '{define: As  base-fret 4 frets 1 3 3 2 1 1 fingers 1 3 4 2 1 1}',
      '[Bes]hello [As]world',
    ].join('\n')
    const { chords } = analyzeChords(src)
    expect(chords.map((c) => c.name)).toEqual(['Bes', 'As'])
    expect(chords[0].shape).toMatchObject({ baseFret: 1, frets: [1, 1, 3, 3, 3, 1] })
    expect(chords[1].shape).toMatchObject({ baseFret: 4, frets: [1, 3, 3, 2, 1, 1] })
  })

  it('maps x and N to muted (-1)', () => {
    const def = parseChordDefinition('D7 base-fret 3 frets x 3 2 3 1 N')
    expect(def.shape.baseFret).toBe(3)
    expect(def.shape.frets).toEqual([-1, 3, 2, 3, 1, -1])
  })

  it('returns a null shape for a properties-only define (no diagram)', () => {
    expect(parseChordDefinition('Am7').shape).toBeNull()
  })

  it('parses keyboard keys', () => {
    expect(parseChordDefinition('D keys 0 4 7').shape).toMatchObject({ keys: [0, 4, 7] })
  })
})

describe('analyzeChords', () => {
  it('reads {diagrams} placement and resolves used chords from the built-in library', () => {
    const { placement, chords } = analyzeChords('{diagrams:top}\n{start_of_verse}\nShe [G]was a [Em]fish [Am]monger [D7]no [A7]wonder\n{end_of_verse}')
    expect(placement).toBe('top')
    expect(chords.map((c) => c.name)).toEqual(['G', 'Em', 'Am', 'D7', 'A7'])
    expect(chords.every((c) => c.shape !== null)).toBe(true)
  })

  it('lets a song {define} override the built-in shape', () => {
    const { chords } = analyzeChords('{define: G base-fret 1 frets 3 2 0 0 3 3}\n[G]hi')
    expect(chords[0].shape.frets).toEqual([3, 2, 0, 0, 3, 3])
  })

  it('honours {diagrams: off}', () => {
    expect(analyzeChords('{diagrams: off}\n[C]x').placement).toBe('off')
  })

  it('ignores annotations [*..] and dedupes', () => {
    const { chords } = analyzeChords('[C]a [*Coda] [C]b [G]c')
    expect(chords.map((c) => c.name)).toEqual(['C', 'G'])
  })
})

describe('extractMetadata', () => {
  it('pulls title/subtitle and an ordered info row (artist/key/tempo/capo)', () => {
    const meta = extractMetadata('{title: Molly}\n{subtitle: Trad}\n{artist: X}\n{tempo: 120}\n{key: G}\n{capo: 2}\n[C]hi')
    expect(meta.title).toBe('Molly')
    expect(meta.subtitle).toBe('Trad')
    // ordered: key, capo, tempo, …, artist
    expect(meta.items.map((i) => i.key)).toEqual(['key', 'capo', 'tempo', 'artist'])
    expect(meta.items.find((i) => i.key === 'capo')).toMatchObject({ label: 'Capo', value: '2' })
  })

  it('supports {meta: name value} and the {t}/{st} shorthands', () => {
    const meta = extractMetadata('{t: A}\n{st: B}\n{meta: key Am}')
    expect(meta).toMatchObject({ title: 'A', subtitle: 'B' })
    expect(meta.items[0]).toMatchObject({ key: 'key', value: 'Am' })
  })

  it('maps title/artist/key/tempo into song fields for import', () => {
    const fields = songFieldsFromChordPro('{title: Molly}\n{artist: Trad}\n{key: G}\n{tempo: 120 BPM}\n[C]hi')
    expect(fields).toEqual({ title: 'Molly', artist: 'Trad', song_key: 'G', tempo: 120 })
  })

  it('returns nulls for fields the ChordPro file omits', () => {
    expect(songFieldsFromChordPro('[C]just chords')).toEqual({ title: null, artist: null, song_key: null, tempo: null })
  })

  it('metadata directives are stripped from chordpro runs (not re-rendered)', () => {
    const { blocks } = parseChordProDocument('{title: A}\n{key: G}\n[C]hi')
    const cp = blocks.filter((b) => b.kind === 'chordpro').map((b) => b.source).join('\n')
    expect(cp).not.toContain('title')
    expect(cp).not.toContain('key')
    expect(cp).toContain('[C]hi')
  })
})

describe('lyricsHtmlFromChordPro', () => {
  it('extracts lyric lines without ChordPro directives or bracketed chords', () => {
    const html = lyricsHtmlFromChordPro([
      '{title: Molly}',
      '{artist: Trad}',
      '{start_of_verse}',
      'She [G]was a fish [Em]monger',
      '{end_of_verse}',
      '',
      '{start_of_chorus}',
      '[C]Alive, alive [G]oh',
      '{end_of_chorus}',
    ].join('\n'))

    expect(html).toBe('<p>She was a fish monger</p><p>Alive, alive oh</p>')
  })

  it('escapes HTML and skips non-lyric environments', () => {
    const html = lyricsHtmlFromChordPro([
      '{start_of_tab}',
      'E|--0--|',
      '{end_of_tab}',
      '{start_of_abc}',
      'K:G',
      '{end_of_abc}',
      '[Am]<hello> & goodbye',
    ].join('\n'))

    expect(html).toBe('<p>&lt;hello&gt; &amp; goodbye</p>')
  })
})

describe('{start_of_tab}', () => {
  it('captures the tab verbatim as a tab block (exact whitespace, with label)', () => {
    const src = '{start_of_tab: Riff}\ne|-------7---10~---|\nB|---8-------------|\n{end_of_tab}'
    const tab = parseChordProDocument(src).blocks.find((b) => b.kind === 'tab')
    expect(tab).toEqual({
      kind: 'tab',
      label: 'Riff',
      text: 'e|-------7---10~---|\nB|---8-------------|',
    })
  })

  it('supports the {sot}/{eot} short forms with no label', () => {
    const tab = parseChordProDocument('{sot}\nE|--0--|\n{eot}').blocks.find((b) => b.kind === 'tab')
    expect(tab).toEqual({ kind: 'tab', label: null, text: 'E|--0--|' })
  })
})

describe('{start_of_grid}', () => {
  it('captures grid lines verbatim with a keyed label', () => {
    const src = '{start_of_grid label="Verse"}\n|| Am . . . | C . . . |\n|  Am . . . | E . . . ||\n{end_of_grid}'
    const grid = parseChordProDocument(src).blocks.find((b) => b.kind === 'grid')
    expect(grid).toEqual({
      kind: 'grid',
      label: 'Verse',
      shape: null,
      lines: ['|| Am . . . | C . . . |', '|  Am . . . | E . . . ||'],
    })
  })

  it('supports {sog}/{eog} and treats the legacy bare arg as a shape (not a label)', () => {
    const grid = parseChordProDocument('{sog: 4x4}\n| C . . . |\n{eog}').blocks.find((b) => b.kind === 'grid')
    expect(grid.label).toBeNull()
    expect(grid.shape).toBe('4x4')
    expect(grid.lines).toEqual(['| C . . . |'])
  })

  it('reads a keyed shape with margins', () => {
    const grid = parseChordProDocument('{start_of_grid shape="1+4x2+4"}\n| C . | G . |\n{end_of_grid}').blocks.find((b) => b.kind === 'grid')
    expect(grid.shape).toBe('1+4x2+4')
  })
})

describe('parseGridShape', () => {
  it('parses full shape with margins', () => {
    expect(parseGridShape('1+4x2+4')).toEqual({ left: 1, measures: 4, beats: 2, right: 4 })
  })
  it('defaults missing margins and falls back when unset/invalid', () => {
    expect(parseGridShape('4x4')).toEqual({ left: 1, measures: 4, beats: 4, right: 1 })
    expect(parseGridShape(null)).toEqual({ left: 1, measures: 4, beats: 4, right: 1 })
    expect(parseGridShape('nonsense')).toEqual({ left: 1, measures: 4, beats: 4, right: 1 })
  })
  it('parses the cells-only form (shape="16") as one measure of N beats, no margins', () => {
    expect(parseGridShape('16')).toEqual({ left: 0, measures: 1, beats: 16, right: 0 })
  })
  it('isValidGridShape accepts MxB / margin / cells forms and rejects junk', () => {
    expect(isValidGridShape('16')).toBe(true)
    expect(isValidGridShape('4x4')).toBe(true)
    expect(isValidGridShape('1+4x2+4')).toBe(true)
    expect(isValidGridShape('abc')).toBe(false)
    expect(isValidGridShape('4x')).toBe(false)
  })
})

describe('transposeGridChord', () => {
  it('transposes a single grid chord', () => {
    expect(transposeGridChord('Am', 2)).toBe('Bm')
    expect(transposeGridChord('C', 0)).toBe('C')
  })
  it('keeps chord suffixes and transposes slash bass notes by the same semitones', () => {
    expect(transposeGridChord('Dm7', 3)).toBe('Fm7')
    expect(transposeGridChord('G/B', 2)).toBe('A/C#')
  })
  it('transposes every chord in a multi-chord (~) cell', () => {
    expect(transposeGridChord('C~A', 2)).toBe('D~B')
  })
  it('passes unparseable tokens through unchanged', () => {
    expect(transposeGridChord('N.C.', 2)).toBe('N.C.')
  })
})

describe('grid shape inheritance + warnings', () => {
  it('a later grid without a shape reuses the previous grid shape', () => {
    const src = '{sog: 4x4}\n| C . . . |\n{eog}\n{sog}\n| G . . . |\n{eog}'
    const grids = parseChordProDocument(src).blocks.filter((b) => b.kind === 'grid')
    expect(grids[0].shape).toBe('4x4')
    expect(grids[1].shape).toBe('4x4')
  })
  it('warns on an unrecognized shape but still renders (defaults)', () => {
    const { warnings } = parseChordProDocument('{start_of_grid shape="bogus"}\n| C . |\n{end_of_grid}')
    expect(warnings.some((w) => /Unrecognized grid shape/.test(w))).toBe(true)
  })
  it('warns when a grid block is never closed', () => {
    const { warnings } = parseChordProDocument('{start_of_grid}\n| C . . . |')
    expect(warnings.some((w) => /missing its \{end_of_grid\}/.test(w))).toBe(true)
  })
  it('warns when legacy {sog: …} syntax carries a property', () => {
    const { warnings } = parseChordProDocument('{start_of_grid: 4x4 label="x"}\n| C . |\n{end_of_grid}')
    expect(warnings.some((w) => /Legacy .* cannot take properties/.test(w))).toBe(true)
  })
  it('warns when a %/%% repeat measure is not left blank', () => {
    const { warnings } = parseChordProDocument('{sog}\n| % C . . | %% . . . | . . . . |\n{eog}')
    expect(warnings.some((w) => /rest of the measure to be blank/.test(w))).toBe(true)
  })
  it('does not warn for well-formed repeat measures', () => {
    const { warnings } = parseChordProDocument('{sog}\n| G7 . . . | % . . . | %% . . . | . . . . |\n{eog}')
    expect(warnings).toEqual([])
  })
})

describe('parseGridLine', () => {
  it('splits margins from the bar/cell body and classifies cells', () => {
    const r = parseGridLine('A    || G7 . | % . | %% . | . . |')
    expect(r.marginLeft).toBe('A')
    expect(r.marginRight).toBe('')
    expect(r.tokens).toEqual([
      { kind: 'bar', text: '||' },
      { kind: 'cell', cell: { kind: 'chord', text: 'G7' } },
      { kind: 'cell', cell: { kind: 'empty' } },
      { kind: 'bar', text: '|' },
      { kind: 'cell', cell: { kind: 'repeat', measures: 1 } },
      { kind: 'cell', cell: { kind: 'empty' } },
      { kind: 'bar', text: '|' },
      { kind: 'cell', cell: { kind: 'repeat', measures: 2 } },
      { kind: 'cell', cell: { kind: 'empty' } },
      { kind: 'bar', text: '|' },
      { kind: 'cell', cell: { kind: 'empty' } },
      { kind: 'cell', cell: { kind: 'empty' } },
      { kind: 'bar', text: '|' },
    ])
  })

  it('puts text after the last bar in the right margin (not a chord)', () => {
    const r = parseGridLine('|: C7 . | %  . :|: G7 . | % . :| repeat 4 times')
    expect(r.marginLeft).toBe('')
    expect(r.marginRight).toBe('repeat 4 times')
    expect(r.tokens[0]).toEqual({ kind: 'bar', text: '|:' })
    expect(r.tokens.at(-1)).toEqual({ kind: 'bar', text: ':|' })
    expect(r.tokens).toContainEqual({ kind: 'bar', text: ':|:' })
  })

  it('recognizes the full set of bar-line symbols', () => {
    for (const bar of ['|', '||', '|.', '|:', ':|', ':|:', '|1', ':|2', ':|2>']) {
      expect(parseGridLine(`${bar} C |`).tokens[0]).toEqual({ kind: 'bar', text: bar })
    }
  })

  it('treats a bar-less line as wholly left margin', () => {
    expect(parseGridLine('Intro only')).toEqual({ marginLeft: 'Intro only', tokens: [], marginRight: '' })
  })
})

describe('buildGridItems (measure-grouped layout)', () => {
  const items = (line) => buildGridItems(parseGridLine(line).tokens)

  it('renders flat measures as cells between bars', () => {
    const r = items('|| G7 . | C7 . |')
    expect(r).toEqual([
      { kind: 'bar', text: '||' },
      { kind: 'flat', cells: [{ kind: 'chord', text: 'G7' }, { kind: 'empty' }] },
      { kind: 'bar', text: '|' },
      { kind: 'flat', cells: [{ kind: 'chord', text: 'C7' }, { kind: 'empty' }] },
      { kind: 'bar', text: '|' },
    ])
  })

  it('centers a % across its own measure (spanning its beats)', () => {
    const r = items('| % . |')
    expect(r).toEqual([
      { kind: 'bar', text: '|' },
      { kind: 'repeat', measures: 1, cells: 2, bars: 0 },
      { kind: 'bar', text: '|' },
    ])
  })

  it('merges a %% with the following measure, dropping the bar but keeping its width', () => {
    // From the official example: `| %% . | . . |` becomes one centered span of 4
    // beat-columns + the absorbed bar (3 bars remain, not 4), so later columns
    // stay aligned with the non-merged rows.
    const r = items('|| G7 . | % . | %% . | . . |')
    expect(r).toEqual([
      { kind: 'bar', text: '||' },
      { kind: 'flat', cells: [{ kind: 'chord', text: 'G7' }, { kind: 'empty' }] },
      { kind: 'bar', text: '|' },
      { kind: 'repeat', measures: 1, cells: 2, bars: 0 },
      { kind: 'bar', text: '|' },
      { kind: 'repeat', measures: 2, cells: 4, bars: 1 },
      { kind: 'bar', text: '|' },
    ])
  })

  it('keeps a measure with a chord beside a repeat as flat (not centered)', () => {
    const r = items('| % C . . |')
    expect(r[1]).toEqual({ kind: 'flat', cells: [{ kind: 'repeat', measures: 1 }, { kind: 'chord', text: 'C' }, { kind: 'empty' }, { kind: 'empty' }] })
  })

  it('falls back to its own measure when %% has no following measure', () => {
    const r = items('| %% . |')
    expect(r).toEqual([
      { kind: 'bar', text: '|' },
      { kind: 'repeat', measures: 2, cells: 2, bars: 0 },
      { kind: 'bar', text: '|' },
    ])
  })
})

describe('voltaInfo', () => {
  it('reads the ending number and the align (>) flag', () => {
    expect(voltaInfo('|1')).toEqual({ number: 1, aligned: false })
    expect(voltaInfo(':|2')).toEqual({ number: 2, aligned: false })
    expect(voltaInfo(':|2>')).toEqual({ number: 2, aligned: true })
    expect(voltaInfo('|1>')).toEqual({ number: 1, aligned: true })
  })

  it('returns null for non-volta bars', () => {
    for (const bar of ['|', '||', '|.', '|:', ':|', ':|:']) expect(voltaInfo(bar)).toBeNull()
  })
})

describe('buildVoltaSpans (bracket em offsets from the body left edge)', () => {
  const cell = parseFloat(GRID_CELL_W)
  const bar = parseFloat(GRID_BAR_W)
  const spans = (line) => buildVoltaSpans(buildGridItems(parseGridLine(line).tokens))

  it('opens on a |N bar and closes at the next repeat-close/double/final bar', () => {
    // |: C... | G7... |1 Am... | F... :|  → ending 1 spans from the |1 bar to the :|
    const start = bar + 4 * cell + bar + 4 * cell // |: + C-measure + | + G7-measure
    const end = start + bar + 4 * cell + bar + 4 * cell // |1 + Am-measure + | + F-measure
    expect(spans('|: C . . . | G7 . . . |1 Am . . . | F . . . :|')).toEqual([
      { number: 1, aligned: false, startEm: start, endEm: end },
    ])
  })

  it('a leading :|2> opens at the body start and carries the align flag', () => {
    const end = bar + 4 * cell + bar + 4 * cell // :|2> + Dm-measure + | + G7-measure
    expect(spans(':|2> Dm . . . | G7 . . . ||')).toEqual([
      { number: 2, aligned: true, startEm: 0, endEm: end },
    ])
  })

  it('a plain | inside the volta does not close it', () => {
    const [s] = spans(':|2 Em . . . | A7 . . . | Dm . . . | G7 . . . ||')
    expect(s).toMatchObject({ number: 2, aligned: false, startEm: 0 })
    expect(s.endEm).toBe(bar + 4 * cell + bar + 4 * cell + bar + 4 * cell + bar + 4 * cell)
  })

  it('a row with no volta bar yields no spans', () => {
    expect(spans('| C . . . | G7 . . . |')).toEqual([])
  })
})

describe('{chord} (inline, display-only)', () => {
  it('renders inline at its position as a chorddef block using the given shape', () => {
    const cd = parseChordProDocument('[G]hi\n{chord: Bb base-fret 1 frets 1 1 3 3 3 1}\nmore')
      .blocks.find((b) => b.kind === 'chorddef')
    expect(cd).toMatchObject({ name: 'Bb', shape: { frets: [1, 1, 3, 3, 3, 1] } })
  })

  it('resolves a bare {chord: Am} to the built-in shape', () => {
    const cd = parseChordProDocument('{chord: Am}').blocks.find((b) => b.kind === 'chorddef')
    expect(cd).toMatchObject({ name: 'Am', shape: { frets: [0, 0, 2, 2, 1, 0] } })
  })

  it('does NOT register into the grid or override a used chord shape (unlike {define})', () => {
    const { chords } = analyzeChords('{chord: Am base-fret 1 frets 1 1 1 1 1 1}\n[Am]hi')
    expect(chords[0].shape.frets).toEqual([0, 0, 2, 2, 1, 0]) // built-in Am, not overridden
  })
})

describe('{comment_box} / {comment_italic}', () => {
  it('emits comment blocks with the right variant (ChordSheetJS drops these)', () => {
    const { blocks } = parseChordProDocument('{comment_box: Loud!}\n{comment_italic: softly}\n{ci: also soft}\n[C]hi')
    const comments = blocks.filter((b) => b.kind === 'comment')
    expect(comments).toEqual([
      { kind: 'comment', text: 'Loud!', variant: 'box' },
      { kind: 'comment', text: 'softly', variant: 'italic' },
      { kind: 'comment', text: 'also soft', variant: 'italic' },
    ])
  })
})

describe('{define … display}', () => {
  it('captures the display name', () => {
    expect(parseChordDefinition('H base-fret 1 frets x 2 4 4 4 2 display B')).toMatchObject({ name: 'H', display: 'B' })
  })

  it('omits display when absent (keeps {name, shape} shape for existing callers)', () => {
    expect(parseChordDefinition('Am7')).toEqual({ name: 'Am7', shape: null })
  })

  it('labels the grid diagram with the display name', () => {
    const { chords } = analyzeChords('{define: H base-fret 1 frets 1 1 3 3 3 1 display Bb}\n[H]hello')
    expect(chords[0].name).toBe('Bb')
    expect(chords[0].shape).toMatchObject({ frets: [1, 1, 3, 3, 3, 1] })
  })
})

describe('{transpose}', () => {
  it('sums {transpose: n} directives', () => {
    expect(getTransposeAmount('{transpose: 2}\n[C]x')).toBe(2)
    expect(getTransposeAmount('{transpose: 2}\n{transpose: -1}\n[C]x')).toBe(1)
    expect(getTransposeAmount('[C]x')).toBe(0)
  })

  it('applies transpose to rendered chords (the High-severity bug)', () => {
    expect(renderChordProHtml('[C]Hello [G]world', 2)).toContain('class="chord">D<')
    expect(renderChordProHtml('[C]Hello [G]world', 2)).toContain('class="chord">A<')
    // without a transpose arg, chords are unchanged
    expect(renderChordProHtml('[C]Hello', 0)).toContain('class="chord">C<')
  })

  it('transposes the diagram grid chord names to match the lyrics', () => {
    const { chords } = analyzeChords('{transpose: 2}\n[C]a [G]b')
    expect(chords.map((c) => c.name)).toEqual(['D', 'A'])
    expect(chords.every((c) => c.shape !== null)).toBe(true)
  })

  it('follows the semitone examples from the ChordSwitch transpose guide', () => {
    // the quality is superscripted: Fm7 -> Fm<sup>7</sup>
    expect(renderChordProHtml('[Dm7]minor seven', 3)).toContain('class="chord">Fm<sup>7</sup></div>')
    expect(renderChordProHtml('[G/B]slash chord', 2)).toContain('class="chord">A/C#<')
    expect(renderChordProHtml('[C]up seven', 7)).toContain('class="chord">G<')
    expect(renderChordProHtml('[C]down five', -5)).toContain('class="chord">G<')

    const { chords } = analyzeChords('{transpose: 2}\n[G/B]slash chord')
    expect(chords[0]).toMatchObject({ name: 'A/C#', shape: { baseFret: 1 } })
  })
})

describe('lookupGuitarChord', () => {
  it('finds common chords and falls back past a slash bass', () => {
    expect(lookupGuitarChord('G')).toMatchObject({ frets: [3, 2, 0, 0, 0, 3] })
    expect(lookupGuitarChord('Am7/G')).toMatchObject({ baseFret: 1 }) // falls back to Am7
    expect(lookupGuitarChord('Zzz')).toBeNull()
  })

  it('includes common sus/add voicings (e.g. Dsus4)', () => {
    expect(lookupGuitarChord('Dsus4')).toMatchObject({ frets: [-1, -1, 0, 2, 3, 3] })
    expect(lookupGuitarChord('Dsus2')).not.toBeNull()
    expect(lookupGuitarChord('Asus4')).not.toBeNull()
    expect(lookupGuitarChord('Esus4')).not.toBeNull()
    expect(lookupGuitarChord('Cadd9')).not.toBeNull()
  })

  it('includes accidental barre chords (Bbm, Eb, …) so they render as SVG', () => {
    expect(lookupGuitarChord('Bbm')).toMatchObject({ baseFret: 1, frets: [-1, 1, 3, 3, 2, 1] })
    expect(lookupGuitarChord('Eb')).toMatchObject({ baseFret: 6, frets: [-1, 1, 3, 3, 3, 1] })
    expect(lookupGuitarChord('Ebm')).not.toBeNull()
    expect(lookupGuitarChord('Ab')).not.toBeNull()
    expect(lookupGuitarChord('F#')).not.toBeNull()
    expect(lookupGuitarChord('G#m')).not.toBeNull()
    // enharmonic + Unicode accidental spellings resolve to the same shape
    expect(lookupGuitarChord('A#m')).toEqual(lookupGuitarChord('Bbm'))
    expect(lookupGuitarChord('E♭')).toEqual(lookupGuitarChord('Eb'))
    expect(lookupGuitarChord('B♭m')).toEqual(lookupGuitarChord('Bbm'))
  })

  it('includes theoretical flat spellings that are enharmonic with natural notes', () => {
    expect(lookupGuitarChord('Cb')).toEqual(lookupGuitarChord('B'))
    expect(lookupGuitarChord('Cbm7')).toEqual(lookupGuitarChord('Bm7'))
    expect(lookupGuitarChord('Fb')).toEqual(lookupGuitarChord('E'))
    expect(lookupGuitarChord('Fbm')).toEqual(lookupGuitarChord('Em'))
    expect(lookupGuitarChord('Gbm')).toEqual(lookupGuitarChord('F#m'))
  })

  it('includes the chart variants for 6, 9, m6, m7, maj7, dim, augmented and sus chords', () => {
    const chartChords = [
      'Ab', 'G#m', 'Ab6', 'Ab7', 'Ab9', 'G#m6', 'G#m7', 'Abmaj7', 'G#dim', 'Ab+', 'Absus',
      'A', 'Am', 'A6', 'A7', 'A9', 'Am6', 'Am7', 'Amaj7', 'Adim', 'A+', 'Asus',
      'Bb', 'Bbm', 'Bb6', 'Bb7', 'Bb9', 'Bbm6', 'Bbm7', 'Bbmaj7', 'Bbdim', 'Bb+', 'Bbsus',
      'B', 'Bm', 'B6', 'B7', 'B9', 'Bm6', 'Bm7', 'Bmaj7', 'Bdim', 'B+', 'Bsus',
      'C', 'Cm', 'C6', 'C7', 'C9', 'Cm6', 'Cm7', 'Cmaj7', 'Cdim', 'C+', 'Csus',
      'Db', 'C#m', 'Db6', 'Db7', 'Db9', 'C#m6', 'C#m7', 'Dbmaj7', 'C#dim', 'Db+', 'Dbsus',
      'D', 'Dm', 'D6', 'D7', 'D9', 'Dm6', 'Dm7', 'Dmaj7', 'Ddim', 'D+', 'Dsus',
      'Eb', 'Ebm', 'Eb6', 'Eb7', 'Eb9', 'Ebm6', 'Ebm7', 'Ebmaj7', 'Ebdim', 'Eb+', 'Ebsus',
      'E', 'Em', 'E6', 'E7', 'E9', 'Em6', 'Em7', 'Emaj7', 'Edim', 'E+', 'Esus',
      'F', 'Fm', 'F6', 'F7', 'F9', 'Fm6', 'Fm7', 'Fmaj7', 'Fdim', 'F+', 'Fsus',
      'F#', 'F#m', 'Gb6', 'F#7', 'F#9', 'F#m6', 'F#m7', 'Gbmaj7', 'F#dim', 'Gb+', 'Gbsus',
      'G', 'Gm', 'G6', 'G7', 'G9', 'Gm6', 'Gm7', 'Gmaj7', 'Gdim', 'G+', 'Gsus',
    ]

    expect(chartChords.filter((name) => lookupGuitarChord(name) === null)).toEqual([])
    expect(lookupGuitarChord('A9')).toMatchObject({ frets: [-1, 0, 2, 4, 2, 3] })
    expect(lookupGuitarChord('Bbm7')).toMatchObject({ baseFret: 1, frets: [-1, 1, 3, 1, 2, 1] })
    expect(lookupGuitarChord('Fsus')).toEqual(lookupGuitarChord('Fsus4'))
  })
})
