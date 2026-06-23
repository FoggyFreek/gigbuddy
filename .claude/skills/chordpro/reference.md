# ChordPro reference — directive tables & authoritative link index

Companion to [SKILL.md](./SKILL.md). The tables below are a quick map; **the URL index at the end is the source of truth** — fetch the specific `directives-<name>` page for exact argument syntax, defaults, and version notes. Do not infer behavior not documented here. Spec baseline: ChordPro 6.07 cheat sheet.

## General syntax recap

- Chords `[ ]`, annotations `[* ]`, directives `{ }` (single line), source comments `#`, continuation with trailing `\`.
- Directive args: colon and/or whitespace separated; multi-arg uses `key="value"` attribute syntax (`'`/`"` equivalent).
- Conditional directives: append `-selector` (e.g. `{chordfont-guitar: ...}`), negate selector with `!`.
- As of 6.0 all args to `{chord}`/`{define}` are optional; section labels are 6.0; continuation + unicode escapes are 6.01.

## Chord definition & display

| Directive | Purpose | Since |
| :--- | :--- | :--- |
| `chord` / `define` | Define or in-line a chord diagram | 1.0 / 5.0 |
| `… base-fret` | Top fret of diagram (1+) | 1.0 |
| `… frets` | Per-string fret positions (low→high; `0` open, `x`/`-1`/`N` muted) | 1.0 |
| `… fingers` | Per-string finger positions (1–9 / A–Z) | 6.0 |
| `… keys` | Keyboard keys as semitone offsets from root | 6.0 |
| `… display` | Override displayed chord properties | 6.02 |
| `… format` | Format string for chord display | 6.02 |
| `… diagram` | Override diagram display/colour | 6.03 |
| `diagrams` | Control whether diagrams print (`on`/`off`); replaces legacy `grid`/`no_grid` | 6.02 |

## Sections / environments

| Directive (short) | Purpose | Since |
| :--- | :--- | :--- |
| `start_of_verse`/`end_of_verse` (`sov`/`eov`) | Verse | 6.0 |
| `start_of_chorus`/`end_of_chorus` (`soc`/`eoc`) | Chorus | 1.0 |
| `start_of_bridge`/`end_of_bridge` (`sob`/`eob`) | Bridge | 6.0 |
| `start_of_tab`/`end_of_tab` (`sot`/`eot`) | Tablature (monospace) | 3.6 |
| `start_of_grid`/`end_of_grid` (`sog`/`eog`) | Chord grid | 5.0 |
| `start_of_<section>`/`end_of_<section>` | Generic section (X = `[A-Za-z0-9_]+`) | 6.0 |
| `chorus` | Recall/re-print a chorus (optional label) | 5.0 |

All section openers take an optional `label="..."` (legacy bare label also works; `\n` allowed).

## Metadata

`{meta: name value}` or shorthand directives. Common keys: `title`(`t`), `subtitle`(`st`), `artist`, `composer`, `lyricist`, `album`, `copyright`, `year`, `key`, `capo`, `tempo`, `time` (n/m), `duration` (mm:ss or sec), `sorttitle`, `sortartist`, `tag`. Repeatable keys (e.g. `tag`, `artist`) collect into lists.

## Comments & highlights (rendered)

| Directive (short) | Purpose |
| :--- | :--- |
| `comment` (`c`) | Rendered comment line |
| `comment_box` (`cb`) | Boxed comment |
| `comment_italic` (`ci`) | Italic comment |
| `highlight` | Same as `comment` |

## Page layout & output

`new_page`(`np`), `new_physical_page`(`npp`), `new_song`(`ns`, optional `toc=`), `column_break`, `columns`(`col`), `pagetype` (paper size).

## Images & media

`{image: src= title= width= height= scale= center[=] border[=] bordertrbl= spread= id= anchor= x= y=}`. Delegated environments (`abc`, `lilypond`, `svg`) convert their body to an image. See `directives-image`.

## Transposition & custom

`{transpose: n}` (semitones, can be conditional). `{x_...}` custom directives — ignored by apps that don't implement them.

## Legacy styling (font / size / colour)

Per element, `*font` / `*size` / `*colour` exist for: `chord` (`cf`/`cs`), `text` (`tf`/`ts`), `chorus`, `tab`, `title`, `toc`, `footer`, `label`, plus `titles` (flush left/center/right). Prefer config/CSS over these legacy directives in new tooling. Detail pages are the `directives-props_*_legacy` entries below.

## Inline text markup (Pango-style)

`chordpro-markup` documents Pango-like markup usable in text/labels: convenience tags `<b> <i> <u> <s> <sub> <sup> <small> <big> <tt>`; general `<span ...>` with `font_desc/face/size/style/weight/foreground/background/underline/rise/href`; struts `<strut .../>`; bookmarks via strut labels; and `<sym name/>` musical symbols (accidentals, repeats, bars). Full attribute list: `chordpro-markup` + the upstream Pango page.

---

## Authoritative URL index (fetch for exact details)

**Spec overview**
- Introduction — https://www.chordpro.org/chordpro/chordpro-introduction/
- Directives reference (index) — https://www.chordpro.org/chordpro/chordpro-directives/
- Chords (notation, roots, extensions, transposition, naming systems) — https://www.chordpro.org/chordpro/chordpro-chords/
- Cheat sheet — https://www.chordpro.org/chordpro/chordpro-cheat_sheet/
- Inline markup (Pango) — https://www.chordpro.org/chordpro/chordpro-markup/
- Configuration — https://www.chordpro.org/chordpro/chordpro-configuration/
- 5.0 / 6.0 release notes — https://www.chordpro.org/chordpro/chordpro5-relnotes/ , https://www.chordpro.org/chordpro/chordpro6-relnotes/
- All pages — https://www.chordpro.org/chordpro/allpages/

**Per-directive detail pages**
- chord/define — https://www.chordpro.org/chordpro/directives-define/ , https://www.chordpro.org/chordpro/directives-chord/
- diagrams — https://www.chordpro.org/chordpro/directives-diagrams/
- sections — https://www.chordpro.org/chordpro/directives-env/ (+ `directives-env_verse/_chorus/_bridge/_tab/_grid`, e.g. https://www.chordpro.org/chordpro/directives-env_chorus/ )
- comment — https://www.chordpro.org/chordpro/directives-comment/
- meta — https://www.chordpro.org/chordpro/directives-meta/ (+ per-key: `directives-title/-subtitle/-artist/-composer/-lyricist/-album/-copyright/-year/-key/-capo/-tempo/-time/-duration/-sorttitle/-sortartist/-tag`)
- transpose — https://www.chordpro.org/chordpro/directives-transpose/
- image — https://www.chordpro.org/chordpro/directives-image/
- columns / column_break — https://www.chordpro.org/chordpro/directives-columns/ , https://www.chordpro.org/chordpro/directives-column_break/
- new_page / new_song — https://www.chordpro.org/chordpro/directives-new_page/ , https://www.chordpro.org/chordpro/directives-new_song/
- custom (x_) — https://www.chordpro.org/chordpro/directives-custom/
- legacy props — `directives-props_chord_legacy/_chorus_legacy/_tab_legacy/_text_legacy/_title_legacy/_toc_legacy/_footer_legacy/_label_legacy`, `directives-titles_legacy`, `directives-grid_legacy`, `directives-pagetype_legacy`

**Program / tooling**
- Reference implementation **source (authoritative for parser edge cases)** — https://github.com/ChordPro/chordpro (Perl `App::Music::ChordPro`; the parser lives under `lib/ChordPro/`, chord config/known chords under `lib/ChordPro/res/`)
- Reference implementation overview — https://www.chordpro.org/chordpro/chordpro-reference-implementation/
- CLI user guide — https://www.chordpro.org/chordpro/using-chordpro/
- Getting started — https://www.chordpro.org/chordpro/chordpro-getting-started/
- Support / FAQ — https://www.chordpro.org/chordpro/support/

**External**
- Pango markup — https://docs.gtk.org/Pango/pango_markup.html
- ChordSheetJS (JS parser/formatter, useful import reference) — https://github.com/martijnversluis/ChordSheetJS
