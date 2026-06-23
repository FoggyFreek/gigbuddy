import Box from '@mui/material/Box'
import type { ChordShape } from '../utils/guitarChords.ts'

// A single guitar chord-diagram box drawn as inline SVG (no dependency). Uses
// currentColor so it tracks the theme on screen, and because the SVG is inline
// it carries into the print window when the viewer clones the DOM. When no shape
// is known the chord name is shown without a fretboard (matching ChordPro, which
// still prints the name of an undefined chord).
interface ChordDiagramProps {
  name: string
  shape: ChordShape | null
}

const STRINGS = 6
const STRING_GAP = 10
const FRET_GAP = 12
const PAD_LEFT = 12
const PAD_RIGHT = 8
const BOARD_TOP = 22
const MUTE = -1

export default function ChordDiagram({ name, shape }: ChordDiagramProps) {
  // No fretted shape (unknown chord, or a keyboard keys-only define): show the
  // name without a fretboard, as ChordPro does for undefined chords.
  if (!shape || shape.frets.length === 0) {
    return (
      <Box className="cp-diagram" sx={{ textAlign: 'center', fontSize: 12, minWidth: 56 }}>
        <Box sx={{ fontWeight: 700, color: 'primary.main' }}>{name}</Box>
      </Box>
    )
  }

  const { baseFret, frets, fingers } = shape
  const maxFret = Math.max(0, ...frets.filter((f) => f > 0))
  const rows = Math.max(4, maxFret)
  const width = PAD_LEFT + (STRINGS - 1) * STRING_GAP + PAD_RIGHT
  const boardBottom = BOARD_TOP + rows * FRET_GAP
  const stringX = (i: number) => PAD_LEFT + i * STRING_GAP

  return (
    <Box className="cp-diagram" sx={{ textAlign: 'center', color: 'text.primary', '& svg': { display: 'block', mx: 'auto' } }}>
      <Box sx={{ fontWeight: 700, fontSize: 12, color: 'primary.main', mb: 0.25 }}>{name}</Box>
      <svg
        viewBox={`0 0 ${width} ${boardBottom + 6}`}
        width={width}
        height={boardBottom + 6}
        fill="none"
        stroke="currentColor"
        strokeWidth={0.7}
      >
        {/* nut (thick) when starting at the top, else the base-fret number */}
        {baseFret === 1 ? (
          <line x1={stringX(0)} y1={BOARD_TOP} x2={stringX(STRINGS - 1)} y2={BOARD_TOP} strokeWidth={2.2} />
        ) : (
          <text x={stringX(0) - 4} y={BOARD_TOP + FRET_GAP - 3} fontSize={7} stroke="none" fill="currentColor" textAnchor="end">
            {baseFret}
          </text>
        )}

        {/* fret lines */}
        {Array.from({ length: rows + 1 }, (_, j) => (
          <line key={`f${j}`} x1={stringX(0)} y1={BOARD_TOP + j * FRET_GAP} x2={stringX(STRINGS - 1)} y2={BOARD_TOP + j * FRET_GAP} />
        ))}

        {/* strings + open/mute markers + dots */}
        {frets.map((f, i) => {
          const x = stringX(i)
          return (
            <g key={`s${i}`}>
              <line x1={x} y1={BOARD_TOP} x2={x} y2={boardBottom} />
              {f === 0 && <circle cx={x} cy={BOARD_TOP - 6} r={2.4} />}
              {f === MUTE && (
                <text x={x} y={BOARD_TOP - 3} fontSize={7} stroke="none" fill="currentColor" textAnchor="middle">×</text>
              )}
              {f > 0 && (
                <>
                  <circle cx={x} cy={BOARD_TOP + (f - 0.5) * FRET_GAP} r={3.4} fill="currentColor" stroke="none" />
                  {fingers && fingers[i] > 0 && (
                    <text x={x} y={BOARD_TOP + (f - 0.5) * FRET_GAP + 2.4} fontSize={6} stroke="none" fill="#fff" textAnchor="middle">
                      {fingers[i]}
                    </text>
                  )}
                </>
              )}
            </g>
          )
        })}
      </svg>
    </Box>
  )
}
