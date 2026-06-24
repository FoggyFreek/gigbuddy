import Box from '@mui/material/Box'
import { useTheme, alpha } from '@mui/material/styles'
import type { Theme } from '@mui/material/styles'
import { formatNote, STANDARD_TUNING, type AbsoluteFret } from '../../utils/chordIdentify.ts'

// A controlled, accessible guitar neck: each string is a row, each fret cell and
// the nut zone is a real <button> (so focus, Tab order and Enter/Space come for
// free and tests can target by aria-label). One note per string, matching
// ChordShape.frets. Click a fret to set it; click the active fret again to mute;
// the nut button toggles the string open/muted. Purely presentational state lives
// in the parent â€” this only emits onChange.
//
// Visually it's drawn like a real fretboard: six horizontal strings (heavier on
// the bass side), metallic fret wires, and inlay position dots painted behind the
// strings (single at 3/5/7/9/15/17/19/21, double at 12/24).
interface InteractiveFretboardProps {
  frets: AbsoluteFret[] // low->high (EADGBe): -1 mute, 0 open, n fret
  onChange: (frets: AbsoluteFret[]) => void
  fretCount?: number
}

const MUTE = -1
const OPEN = 0
const ROW_H = 30
// Low string -> high. Index 0 is the low E (frets[0]); rows render high-e on top.
const STRING_LABELS = ['low E', 'A', 'D', 'G', 'B', 'high e']
const DISPLAY_ROWS = [5, 4, 3, 2, 1, 0] // top -> bottom
// String gauge by string index (bass thickest), in px.
const STRING_WIDTHS = [3, 2.6, 2.2, 1.8, 1.4, 1.1]
// Inlay markers, the dots fretted instruments carry on the board face.
const SINGLE_MARKERS = [3, 5, 7, 9, 15, 17, 19, 21]
const DOUBLE_MARKERS = [12, 24]
const BOARD_H = ROW_H * DISPLAY_ROWS.length
const BOARD_CENTER_Y = BOARD_H / 2
const DOUBLE_MARKER_SPACING = 2 * ROW_H

export default function InteractiveFretboard({ frets, onChange, fretCount = 15 }: InteractiveFretboardProps) {
  const theme = useTheme()

  const setString = (string: number, value: AbsoluteFret) => {
    const next = frets.slice()
    next[string] = value
    onChange(next)
  }

  // Toggle a fret: select it, or mute the string if it was already selected.
  const handleFret = (string: number, fret: number) => {
    setString(string, frets[string] === fret ? MUTE : fret)
  }

  // Nut toggles between open and muted.
  const handleNut = (string: number) => {
    setString(string, frets[string] === OPEN ? MUTE : OPEN)
  }

  const dotColor = theme.palette.primary.main
  const inlayColor = alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.32 : 0.22)
  const gridCols = `2.5rem 2rem repeat(${fretCount}, 1fr)`
  const allFrets = Array.from({ length: fretCount }, (_, i) => i + 1)

  return (
    <Box role="group" aria-label="Guitar fretboard" sx={{ userSelect: 'none', minWidth: 'max-content' }}>
      {/* Header: fret numbers aligned to the fret columns. */}
      <Box sx={{ display: 'grid', gridTemplateColumns: gridCols }}>
        <Box />
        <Box sx={{ textAlign: 'center', fontSize: 11, color: 'text.secondary' }}>0</Box>
        {allFrets.map((n) => (
          <Box key={`h${n}`} sx={{ textAlign: 'center', fontSize: 11, color: 'text.secondary' }}>
            {isMarker(n) ? n : ''}
          </Box>
        ))}
      </Box>

      {/* The board: an inlay layer painted behind the interactive string rows. */}
      <Box
        sx={{
          position: 'relative',
          bgcolor: theme.palette.mode === 'dark' ? alpha('#7a5230', 0.18) : alpha('#caa472', 0.22),
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: 1,
        }}
      >
        {/* Inlay dots at fixed string-boundary offsets: a single dot on the
            board centre line (between rows 3 & 4), a pair between rows 2/3 and
            rows 4/5. */}
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            gridTemplateColumns: gridCols,
            gridTemplateRows: `${BOARD_H}px`,
            pointerEvents: 'none',
          }}
        >
          {[...SINGLE_MARKERS, ...DOUBLE_MARKERS]
            .filter((fret) => fret <= fretCount)
            .map((fret) => {
              const offsets = DOUBLE_MARKERS.includes(fret)
                ? [BOARD_CENTER_Y - DOUBLE_MARKER_SPACING / 2, BOARD_CENTER_Y + DOUBLE_MARKER_SPACING / 2]
                : [BOARD_CENTER_Y]
              return (
                <Box key={`inlay${fret}`} sx={{ gridColumn: fret + 2, gridRow: 1, position: 'relative' }}>
                  {offsets.map((top) => (
                    <Box
                      key={top}
                      sx={{ position: 'absolute', top, left: '50%', transform: 'translate(-50%, -50%)' }}
                    >
                      <Dot color={inlayColor} />
                    </Box>
                  ))}
                </Box>
              )
            })}
        </Box>

        {/* Interactive string rows on top, high-e at the top. */}
        <Box sx={{ position: 'relative', display: 'grid', gridTemplateColumns: gridCols }}>
          {DISPLAY_ROWS.map((string) => {
            const label = STRING_LABELS[string]
            const value = frets[string]
            const stringLine = stringLineBg(theme, string)
            return (
              <Box key={label} sx={{ display: 'contents' }}>
                <Box sx={{ height: ROW_H, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', pr: 0.5, fontSize: 12, color: 'text.secondary' }}>
                  {label}
                </Box>

                {/* Nut: open note / muted marker toggle. */}
                <Box
                  component="button"
                  type="button"
                  onClick={() => handleNut(string)}
                  aria-label={`Toggle ${label} string open or muted, currently ${stateLabel(value)}`}
                  sx={nutSx(theme, value, stringLine)}
                >
                  {value === OPEN ? (
                    <NoteBadge
                      label={noteAt(string, OPEN)}
                      bgcolor={theme.palette.secondary.main}
                      color={theme.palette.secondary.contrastText}
                    />
                  ) : value === MUTE ? 'X' : ''}
                </Box>

                {/* Fret cells; a placed fret shows the note it sounds. */}
                {allFrets.map((fret) => {
                  const active = value === fret
                  return (
                    <Box
                      component="button"
                      type="button"
                      key={`${label}-${fret}`}
                      onClick={() => handleFret(string, fret)}
                      aria-label={`Set ${label} string to fret ${fret}`}
                      aria-pressed={active}
                      sx={cellSx(theme, stringLine)}
                    >
                      {active && (
                        <NoteBadge
                          label={noteAt(string, fret)}
                          bgcolor={dotColor}
                          color={theme.palette.primary.contrastText}
                        />
                      )}
                    </Box>
                  )
                })}
              </Box>
            )
          })}
        </Box>
      </Box>
    </Box>
  )
}

function NoteBadge({ label, bgcolor, color }: { label: string; bgcolor: string; color: string }) {
  return (
    <Box
      sx={{
        minWidth: 20,
        height: 20,
        px: 0.25,
        borderRadius: '10px',
        bgcolor,
        color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1,
        boxShadow: 1,
      }}
    >
      {label}
    </Box>
  )
}

function Dot({ color }: { color: string }) {
  return <Box sx={{ width: 11, height: 11, borderRadius: '50%', bgcolor: color }} />
}

function isMarker(fret: number): boolean {
  return SINGLE_MARKERS.includes(fret) || DOUBLE_MARKERS.includes(fret)
}

// The note a string sounds at a given fret, in standard tuning.
function noteAt(string: number, fret: number): string {
  return formatNote((STANDARD_TUNING[string] + fret) % 12)
}

function stateLabel(value: AbsoluteFret): string {
  if (value === OPEN) return 'open'
  if (value === MUTE) return 'muted'
  return `fret ${value}`
}

// A horizontal string line, drawn as a centred gradient stripe so it runs
// continuously across every cell of the row; gauge thickens toward the bass.
function stringLineBg(theme: Theme, string: number): string {
  const w = STRING_WIDTHS[string] / 2
  const c = theme.palette.mode === 'dark' ? alpha('#d9d9d9', 0.85) : alpha('#5a5a5a', 0.85)
  return `linear-gradient(to bottom, transparent calc(50% - ${w}px), ${c} calc(50% - ${w}px), ${c} calc(50% + ${w}px), transparent calc(50% + ${w}px))`
}

function nutSx(theme: Theme, value: AbsoluteFret, stringLine: string) {
  return {
    height: ROW_H,
    border: 'none',
    p: 0,
    backgroundColor: 'transparent',
    backgroundImage: stringLine,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    fontWeight: 700,
    color: value === MUTE ? theme.palette.text.disabled : theme.palette.text.primary,
    borderRight: `3px solid ${theme.palette.text.primary}`, // the nut
    '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
  } as const
}

function cellSx(theme: Theme, stringLine: string) {
  return {
    height: ROW_H,
    minWidth: 22,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    borderRight: `2px solid ${alpha(theme.palette.text.primary, 0.45)}`, // fret wire
    backgroundColor: 'transparent',
    backgroundImage: stringLine,
    cursor: 'pointer',
    p: 0,
    '&:hover': { backgroundColor: theme.palette.action.hover },
    '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
  } as const
}
