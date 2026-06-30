---
name: chordpro
description: ChordPro (.pro/.cho/.chordpro) lead-sheet format — its syntax and concepts, plus a map of how this app already parses, edits, and renders it. Use as a reference when working on the ChordPro charts feature (src/utils/chordpro.ts, ChordProView, ChordDiagram, the songs charts routes). Authoritative format details live at chordpro.org; see reference.md for the full directive tables and link index.
user-invocable: false
---

# ChordPro — format reference & where it lives in this app

ChordPro is a plain-text lead-sheet format: lyrics with inline `[chords]`, plus `{directives}` for metadata and structure. Extensions: `.pro`, `.cho`, `.chopro`, `.chordpro`, `.crd`, `.chord`. Current spec is ChordPro 6.x.

**This file is a working reference for understanding the format and this app's implementation — not a build plan; the feature already exists.** Read it before touching the ChordPro code so you know the syntax rules and which file owns what. [reference.md](./reference.md) has the complete directive tables and the canonical URL index. Never invent directive behavior; if unsure, fetch the specific `directives-<name>` page from chordpro.org.

## Where the feature lives in this codebase

ChordPro **charts** are editable text lead-sheets attached to a song (one song → many named charts, e.g. "Guitar", "Piano (Bb)").

| Concern | File |
| :--- | :--- |
| Parsing + rendering helpers (the core) | `src/utils/chordpro.ts` |
| Built-in guitar chord shapes (stand-in for ChordPro's instrument config) | `src/utils/guitarChords.ts` |
| On-screen renderer (chords-over-lyrics, grid, tab, ABC, diagrams) | `src/components/ChordProView.tsx` |
| Single chord-diagram SVG | `src/components/ChordDiagram.tsx` |
| Embedded ABC notation block | `src/components/AbcBlock.tsx` |
| Fullscreen viewer + source editor + print/PDF | `src/components/ChordProViewerDialog.tsx` |
| Chart list on a song (add/delete) | `src/components/ChordProChartsSection.tsx` |
| Import a `.pro` file as a new song | `src/components/SongImportMenu.tsx` |
| API wrapper | `src/api/songs.ts` (`createSongChart`/`uploadSongChart`/`updateSongChart`/`deleteSongChart`) |
| Backend route/service/repo | `server/routes/songs.js` (`/:id/charts*`), `songService.js`, `songRepository.js` |
| Storage | migration `093_song_chordpro_charts.sql` — `song_chordpro_charts(source TEXT, …)`, text inline (not object storage) |
| Tests | `src/tests/chordpro.test.js`, `ChordProView.test.jsx`, `ChordProViewerDialog.test.jsx`, `ChordProChartsSection.test.jsx`, `server/songs.test.js` |

**Two security/correctness landmines already handled — don't regress them:**
- **ChordSheetJS does not escape lyric/chord text**, so its HTML output is run through **DOMPurify** (`renderChordProHtml`). A malicious uploaded chart could otherwise inject script (stored XSS, even intra-tenant). Keep sanitization on any path that turns chart source into DOM.
- Charts are tenant-owned; the route is `requirePermission(PLANNING_WRITE)` and the table has the composite `(song_id, tenant_id)` FK backstop. Stay tenant-scoped.

## How parsing/rendering is split (the key architecture)

This app does **not** hand the whole file to ChordSheetJS. `parseChordProDocument` (in `chordpro.ts`) splits the source into ordered `DocBlock`s; only the plain **chords-over-lyrics runs** go to ChordSheetJS (`renderChordProHtml` → `ChordProParser` + `HtmlDivFormatter` → DOMPurify). Everything else is owned by app code because ChordSheetJS either mangles it or drops it:

- **`{start_of_tab}`** → own `tab` block rendered as a real `<pre>` (fixed-width, exact whitespace) — ChordSheetJS's flex `.literal` can't guarantee column alignment.
- **`{start_of_grid}`** (Jazz Grille) → own `grid` block, laid out by *shape* into fixed-width beat cells + bar slots so chords align vertically regardless of source spacing. This is the most involved part: grid shape (`1+4x4+1`), measure-repeats (`%`/`%%`), voltas/endings (`|1`, `:|2`, `:|2>`), bar-line glyphs. See the `parseGridLine` / `buildGridItems` / `buildVoltaSpans` functions and `GridBlock` in `ChordProView.tsx`.
- **`{start_of_abc}`** → engraved with abcjs in `AbcBlock`.
- **`{image: …}`**, **`{columns}`/`{colb}`**, **`{comment_box}`/`{comment_italic}`**, **`{chord: …}`** (inline diagram) → own blocks; ChordSheetJS would otherwise emit broken markup or silently drop them.
- **Metadata** (`{title}`, `{artist}`, …) is hoisted to a header (`extractMetadata`) and stripped from the runs so it isn't re-printed.
- **`{transpose: n}`** is parsed by ChordSheetJS but **not applied** by it — this app reads the amount (`getTransposeAmount`) and calls `song.transpose()` itself, summing source directives with the viewer's interactive ▲/▼ offset.

When ChordSheetJS can't parse a run, the renderer falls back to raw monospace text rather than failing.

## The four lexical elements

Every line is one of these (ChordPro is line-oriented; directives and section markers must be alone on their line):

| Element | Syntax | Notes |
| :--- | :--- | :--- |
| Chord | `[C]`, `[Am7/G]` | Placed *before* the syllable it sits over. Renders above lyrics. |
| Annotation | `[*Coda]`, `[*Rit.]` | Asterisk prefix → printed as literal text above lyrics, not parsed as a chord. |
| Directive | `{title: ...}` | Between `{` `}`, single line. Name + optional args. |
| Comment | `# ...` | Whole line, ignored by parsers (this is a *source* comment, **not** `{comment:}` which is rendered). |

Other rules a parser honors:
- **Empty lines** separate stanzas — preserve them.
- **Line continuation**: a trailing backslash `\` appends the next source line (since 6.01).
- **Encodings**: ASCII, ISO-8859.1, UTF-8/16/32. Decode to Unicode before parsing (uploads go through `server/utils/decodeText.js`).
- A `[` that isn't a well-formed chord/annotation is literal text.

## Chord grammar

A chord between brackets decomposes into four parts: **root**, **qual** (quality), **ext** (extension), **bass** (after a `/`).
`Am7/G` → root=`A`, qual=`m`, ext=`7`, bass=`G`.

- **Roots**: `A`–`G`; German `H` (= B), accidentals `#`/`b` (and Unicode `♯`/`♭`); enharmonic spellings recognized (`Bb`, `B♭`, `Bes`). Also Roman `I`–`VII`, Nashville `1`–`7`.
- **Qual/ext**: built-in lists cover `m`/`mi`/`min`/`-`, `maj`, `7 9 11 13`, `sus`, `add`, `aug`, `dim`, etc. See `chordpro-chords` for the full extension list.
- **Strict vs relaxed parsing**: strict mode requires a valid structure and built-in extensions; relaxed mode accepts custom extensions (`[Coda]` → root `C`, ext `oda`). Strict for validation, relaxed for lenient import.
- **Transposition** needs at least a recognized root; it substitutes the root (and bass) while preserving qual/ext. Honors `{transpose: n}` (semitones) and `{meta capo}`/`{key}`. In this app the grid path transposes via `transposeGridChord` (handling multi-chord `C~A` cells); lyric runs via ChordSheetJS's `song.transpose()`.
- **Notes mode**: lowercase single letters (`[f]`) are note names, transposed but not diagrammed.
- Unrecognized chords are kept verbatim and rendered as-is.

## Chord diagrams: `{define}`, `{chord}`, `{diagrams}` and the built-in library

```
{define: NAME base-fret B frets P P P P P P [fingers F F F F F F]}
{define: NAME keys N N N}        # keyboard
```

- **base-fret B**: fret of the topmost row of the diagram, `1` or higher.
- **frets**: one value per string, **low pitch → high pitch** (matches a printed diagram left→right). `0` = open, `1–9` = fret (relative to base-fret − 1), `x`/`-1`/`N` = muted. 6 strings by default.
- **fingers**: optional, `1–9`/`A–Z`; values for open/muted strings are ignored.
- **keys**: keyboard offsets from root — `0` root, `3` minor / `4` major third, `7` fifth, `11` dom 7th.

In this app `parseChordDefinition` (in `chordpro.ts`) turns a `{define}`/`{chord}` arg string into a `ChordShape` (`{ baseFret, frets, fingers?, keys? }`, the type from `guitarChords.ts`). Sub-directives `display`/`format`/`diagram`/`copy` are recognized but not all rendered (parsing stops at `format`/`diagram`/`copy`).

**`{chord}` vs `{define}`**: `{define}` **registers** a reusable shape for the diagram grid; `{chord: …}` is **display-only and inline** — it shows a diagram right where it appears and does *not* register. Bracket form `[ ]` is the only form that transposes; a bare name never does. In this app, `{chord}` is matched in `parseChordProDocument` (emits a `chorddef` block); `{define}` is collected in `analyzeChords` for the grid.

**`{diagrams}`** controls the auto-generated grid of all chords used: `on`/`off`/`top`/`bottom`. In `analyzeChords`, placement resolves to `top|bottom|off`; `ChordProView` shows a collapsible diagram grid on screen and a print version.

**Built-in library**: common chords (G, Em, Am, D7, …) have shapes in `src/utils/guitarChords.ts` (`lookupGuitarChord`), the app's stand-in for ChordPro's instrument config files — a song needs no `{define}` for them. A song's own `{define}`/`{chord}` **overrides** the built-in. A chord with no resolvable shape renders as just its name (matching ChordPro, which still prints the name of an undefined chord).

## Sections / environments

`{start_of_X}` … `{end_of_X}` where X is `[A-Za-z0-9_]+`. Special handling for **chorus**, **tab**, **grid**; **verse/bridge** are conventional. Short forms: `sov/eov`, `soc/eoc`, `sob/eob`, `sot/eot`, `sog/eog`. Labels: `{start_of_verse: label="Verse 1"}` (legacy: `{soc: Chorus}`); `\n` allowed in labels. `{chorus}` *recalls* (re-prints) a prior chorus. **Unknown environments are treated as plain lyric lines**, never dropped. (Tab/grid/abc/textblock are intercepted before reaching ChordSheetJS — see the architecture section above.)

## Directives & conditional selectors

- Args separate by colon and/or whitespace: `{title: X}`. Multi-arg uses attribute syntax with quotes: `{image: src="f.jpg" scale="50%"}` (`'` and `"` equivalent). In `chordpro.ts`, `readAttr`/`readLabel`/`readAlign` parse these arg strings.
- **Conditional**: append `-selector` → `{define-guitar: ...}`; matches instrument/user/metadata, negate with `!`. Section openers apply the selector to their whole body; closers omit it.
- **Custom directives** are prefixed `x_…` and must be ignored by apps that don't support them.
- Full categorized tables (metadata, formatting, legacy font/size/colour, page layout, images, transpose) are in [reference.md](./reference.md).

## Recommended data model (for reference / new parsing work)

ChordPro parses cleanly to a structured AST. This app's runtime model is the `DocBlock[]` of `parseChordProDocument` (block-per-special-directive, lyric runs left as source for ChordSheetJS); the AST below is the fuller conceptual shape if you ever need richer parsing:

```ts
interface ChordProSong {
  meta: Record<string, string | string[]>   // title, artist, key, tempo, capo, time, ...
  defines: ChordDefinition[]                 // from {define}/{chord}
  sections: Section[]
}
interface Section {
  type: 'verse' | 'chorus' | 'bridge' | 'tab' | 'grid' | 'none' | string  // X from start_of_X
  label?: string
  lines: Line[]
}
interface Line {
  items: Array<                              // ordered, left→right
    | { chord: string }                      // a [chord]
    | { annotation: string }                 // a [*text]
    | { text: string }                       // a lyric run
  >
}
interface ChordDefinition {
  name: string
  baseFret: number                           // 1+
  frets: Array<number | 'x'>                 // per string, low→high; 0=open, -1/x=muted
  fingers?: Array<number | string>           // optional, per string
  keys?: number[]                            // keyboard: semitones from root
}
```

Keep stanzas/empty lines as boundaries so round-tripping back to source preserves layout.

## Working in this area — practical notes

- **Edit the source text as the source of truth.** The viewer/editor (`ChordProViewerDialog`) edits raw ChordPro with a live preview; auto-save is debounced (`useDebouncedSave`, `flush()` on close). Don't introduce a second editable representation that can drift.
- **Round-trip safely**: preserve comments, blank lines, and unknown directives — be lenient, never fatal on malformed input.
- **Test-first** (this repo's workflow): adjust/add a test in `src/tests/chordpro.test.js` (pure parsing) or the component tests, watch it fail, then implement. Frontend tests run via `infisical run -- npm test -- --run src/tests/<file>`.
- **Print/PDF parity**: the on-screen `sx` colors track the theme; the print window uses the standalone `CHORDPRO_PRINT_CSS` and clones the live DOM (so inline abcjs SVGs come along). When you change a rendered structure, update both the `sx` and the `cp-*` print CSS.
- For format edge cases, **ChordSheetJS** (the JS parser) and the official Perl `chordpro` CLI are the references — see reference.md.

## Where to find more

Anything not above: open the matching page in [reference.md](./reference.md)'s URL index (e.g. `directives-transpose`, `directives-image`, `chordpro-chords`, `chordpro-markup` for Pango-style inline `<b>/<i>/<span>` markup). Treat chordpro.org as authoritative over memory.
