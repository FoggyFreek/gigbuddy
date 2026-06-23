---
name: chordpro
description: ChordPro (.pro/.cho/.chordpro) lead-sheet format — syntax, parsing grammar, a recommended data model, and how to build an importer, an editor/designer, and a visualizer (chords-over-lyrics + chord diagrams). Use when adding, parsing, editing, or rendering ChordPro song files. Authoritative details live at chordpro.org; see reference.md for the full directive tables and link index.
---

# ChordPro format — importer, designer, visualizer

ChordPro is a plain-text lead-sheet format: lyrics with inline `[chords]`, plus `{directives}` for metadata and structure. Extensions: `.pro` (use this), `.cho`, `.chopro`, `.chordpro`, `.crd`, `.chord`. Current spec is ChordPro 6.x.

**This file is the working knowledge.** [reference.md](./reference.md) has the complete directive tables and the canonical URL index — follow those links to chordpro.org for any detail not covered here. Never invent directive behavior; if unsure, fetch the specific `directives-<name>` page.

## The four lexical elements

Every line is one of these (ChordPro is line-oriented; directives and section markers must be alone on their line):

| Element | Syntax | Notes |
| :--- | :--- | :--- |
| Chord | `[C]`, `[Am7/G]` | Placed *before* the syllable it sits over. Renders above lyrics. |
| Annotation | `[*Coda]`, `[*Rit.]` | Asterisk prefix → printed as literal text above lyrics, not parsed as a chord. |
| Directive | `{title: ...}` | Between `{` `}`, single line. Name + optional args. |
| Comment | `# ...` | Whole line, ignored by parsers (this is a *source* comment, **not** `{comment:}` which is rendered). |

Other rules a parser must honor:
- **Empty lines** separate stanzas — preserve them.
- **Line continuation**: a trailing backslash `\` appends the next source line (since 6.01).
- **Encodings**: ASCII, ISO-8859.1, UTF-8/16/32. Decode to Unicode before parsing.
- A `[` that isn't a well-formed chord/annotation is literal text.

## Chord grammar (for the importer)

A chord between brackets decomposes into four parts: **root**, **qual** (quality), **ext** (extension), **bass** (after a `/`).
`Am7/G` → root=`A`, qual=`m`, ext=`7`, bass=`G`.

- **Roots**: `A`–`G`; German `H` (= B), accidentals `#`/`b` (and Unicode `♯`/`♭`); enharmonic spellings recognized (`Bb`, `B♭`, `Bes`). Also Roman `I`–`VII`, Nashville `1`–`7`.
- **Qual/ext**: built-in lists cover `m`/`mi`/`min`/`-`, `maj`, `7 9 11 13`, `sus`, `add`, `aug`, `dim`, etc. See `chordpro-chords` for the full extension list.
- **Strict vs relaxed parsing**: strict mode requires a valid structure and built-in extensions; relaxed mode accepts custom extensions (`[Coda]` → root `C`, ext `oda`). Pick strict for validation, relaxed for lenient import.
- **Transposition** needs at least a recognized root; it substitutes the root (and bass) while preserving qual/ext. Honor `{transpose: n}` (semitones) and `{meta capo}`/`{key}`.
- **Notes mode**: lowercase single letters (`[f]`) are note names, transposed but not diagrammed.
- Unrecognized chords are kept verbatim and rendered as-is.

## Recommended data model

Parse to a structured AST, not strings — the designer and visualizer both consume it:

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
interface ChordDefinition {                  // see {define} below
  name: string
  baseFret: number                           // 1+
  frets: Array<number | 'x'>                 // per string, low→high; 0=open, -1/x=muted
  fingers?: Array<number | string>           // optional, per string
  keys?: number[]                            // keyboard: semitones from root
}
```

Keep stanzas/empty lines as `Line` boundaries so round-tripping back to source preserves layout.

## {define} — chord diagrams (for the visualizer)

```
{define: NAME base-fret B frets P P P P P P [fingers F F F F F F]}
{define: NAME keys N N N}        # keyboard
```

- **base-fret B**: fret of the topmost row of the diagram, `1` or higher.
- **frets**: one value per string, **low pitch → high pitch** (matches a printed diagram left→right). `0` = open, `1–9` = fret (relative to base-fret − 1), `x`/`-1`/`N` = muted/not played. 6 strings by default.
- **fingers**: optional, `1–9`/`A–Z`; values for open/muted strings are ignored.
- **keys**: keyboard offsets from root — `0` root, `3` minor / `4` major third, `7` fifth, `11` dom 7th; out-of-range values wrap silently.

Example: `{define: C7 base-fret 1 frets x 3 2 3 1 0}`, `{define: D7 base-fret 3 frets x 3 2 3 1 x}`, `{define: Bes base-fret 1 frets 1 1 3 3 3 1 fingers 1 1 2 3 4 1}`, `{define: D keys 0 4 7}`.

**Sub-directives** (append to a `{define}`/`{chord}` arg list):
- `copy B` — reuse `base_fret/frets/fingers/keys` from chord `B`; `copyall B` also copies its `display`/`format`.
- `display NAME` — the name shown in body + diagram (uses `NAME`'s chord *properties* for layout).
- `format FMT` — display format string; escape `%{` as `\%{` so substitution isn't applied too early. Default: `%{root|%{}\%{qual}\%{ext}\%{bass|/\%{}|\%{name}}`.
- `diagram off|on|<color>` — suppress, force, or color this chord's diagram box.

**`{chord}` vs `{define}`**: `{chord: …}` takes the *same* arg grammar but is **display-only and inline** — it shows the diagram right where it appears and does **not** register a reusable definition. `{chord: Am}` (or `{chord: [Am]}`) just shows a known chord; bracket form `[ ]` is the only form that transposes/transcodes — a bare name never does.

**`{diagrams}`** controls the auto-generated grid of all chords used in the song: `on`/`off` and placement `top|bottom|right|below` (default: on, bottom of first page). It does **not** define chords — it decides whether/where the collected diagrams print.

**Built-in library**: common chords (G, Em, Am, D7, …) have shapes in ChordPro's instrument **config files** (the `notes`/`chords` sections), so a song needs no `{define}` for them. `{define}` *extends/overrides* that library. A `{define}` with no `frets`/`keys` (e.g. `{define: Am7}`) registers properties but **no diagram**. If a chord can't be parsed (`root` empty, e.g. `NC`), fall back to showing the raw `name`.

## Sections / environments

`{start_of_X}` … `{end_of_X}` where X is `[A-Za-z0-9_]+`. Special handling for **chorus**, **tab**, **grid**; **verse/bridge** are conventional. Short forms: `sov/eov`, `soc/eoc`, `sob/eob`, `sot/eot`, `sog/eog`. Labels: `{start_of_verse: label="Verse 1"}` (legacy: `{soc: Chorus}`); `\n` allowed in labels. `{chorus}` *recalls* (re-prints) a prior chorus. **Unknown environments must be treated as plain lyric lines**, never dropped.

## Directives & conditional selectors

- Args separate by colon and/or whitespace: `{title: X}`. Multi-arg uses attribute syntax with quotes: `{image: src="f.jpg" scale="50%"}` (`'` and `"` equivalent).
- **Conditional**: append `-selector` → `{define-guitar: ...}`; matches instrument/user/metadata, negate with `!`. Section openers apply the selector to their whole body; closers omit it.
- **Custom directives** are prefixed `x_…` and must be ignored by apps that don't support them.
- Full categorized tables (metadata, formatting, legacy font/size/colour, page layout, images, transpose) are in [reference.md](./reference.md).

## Building the three pieces

### Importer (parser)
1. Decode to Unicode; split into lines; strip `#` comments; apply `\` continuations.
2. Per line: if `{...}` → directive (split name/args, handle `-selector`); else tokenize lyric line into the ordered `[chord]`/`[*anno]`/text `items`.
3. Track an environment stack for `start_of_*`/`end_of_*`; default section type `none`.
4. Collect `{define}`/`{chord}` into `defines`; collect metadata into `meta` (note repeatable keys like `tag` → arrays).
5. Be lenient: unknown directives and malformed chords are preserved, never fatal. Add tests with real-world `.pro` files. Consider the JS lib **ChordSheetJS** as a reference/fallback rather than reinventing edge cases.

### Designer (editor)
- Edit the **source text** with live preview, or edit the AST and serialize back — keep one as source of truth to avoid drift.
- Provide directive/section insertion helpers (title, key, capo, start/end chorus) and chord autocompletion from the root/qual/ext grammar.
- Validate in strict mode and surface unknown directives as warnings, not errors. Offer transpose/capo controls that rewrite chords via the transposition rules.
- Round-trip safely: preserve comments, blank lines, and unknown directives.

### Visualizer (renderer)
- Render each `Line` as chords aligned above their syllables (e.g. inline-blocks: chord stacked over the text run that follows it). Empty lines = stanza gaps.
- Style sections by type (chorus indented/barred, tab in monospace, comments boxed/italic per `comment`/`comment_box`/`comment_italic`).
- Render chord diagrams from `defines` (or a built-in chord dictionary) using the fret/finger model above; for keyboards, draw keys from offsets.
- Apply `{transpose}`, capo, and `{key}` before display; support a chords-only / lyrics-only toggle. Honor `\n` in labels and the `{chorus}` recall.
- For PDF/print parity, the official `chordpro` CLI is the reference renderer.

## Where to find more

Anything not above: open the matching page in [reference.md](./reference.md)'s URL index (e.g. `directives-transpose`, `directives-image`, `chordpro-chords`, `chordpro-markup` for Pango-style inline `<b>/<i>/<span>` text markup). Treat chordpro.org as authoritative over memory.
