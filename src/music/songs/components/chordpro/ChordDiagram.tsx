import Box from '@mui/material/Box'
import ChordName from './ChordName.tsx'
import type { ChordShape } from '../../guitarChords.ts'

// A single guitar chord-diagram box drawn as inline SVG (no dependency). Uses
// currentColor so it tracks the theme on screen, and because the SVG is inline
// it carries into the print window when the viewer clones the DOM. When no shape
// is known the chord name is shown without a fretboard (matching ChordPro, which
// still prints the name of an undefined chord).
interface ChordDiagramProps {
  name: string
  shape: ChordShape | null
}

const STRING_GAP = 10
const FRET_GAP = 12
const PAD_LEFT = 12
const PAD_RIGHT = 8
const BOARD_TOP = 22
const MUTE = -1

export default function ChordDiagram({ name, shape }: Readonly<ChordDiagramProps>) {
  if (shape?.keys?.length && shape.frets.length === 0) {
    const active = new Set(shape.keys.map((key) => ((key % 12) + 12) % 12))
    const whites = [0, 2, 4, 5, 7, 9, 11]
    const blacks = [{ pc: 1, x: 9 }, { pc: 3, x: 21 }, { pc: 6, x: 45 }, { pc: 8, x: 57 }, { pc: 10, x: 69 }]
    return (
      <Box className="cp-diagram cp-keyboard-diagram" sx={{ textAlign: 'center', color: 'text.primary' }}>
        <Box sx={{ fontWeight: 700, fontSize: 12, color: 'primary.main', mb: 0.25 }}><ChordName name={name} /></Box>
        <svg viewBox="0 0 84 38" width="84" height="38" aria-label={`${name} keyboard diagram`}>
          {whites.map((pc, i) => <rect key={pc} x={i * 12} y="0" width="12" height="36" fill={active.has(pc) ? 'currentColor' : '#fff'} stroke="currentColor" />)}
          {blacks.map(({ pc, x }) => <rect key={pc} x={x} y="0" width="7" height="22" fill={active.has(pc) ? '#777' : '#111'} stroke="currentColor" />)}
        </svg>
      </Box>
    )
  }

  // No known fretted or keyboard shape: show only the name.
  if (!shape || shape.frets.length === 0) {
    return (
      <Box className="cp-diagram" sx={{ textAlign: 'center', fontSize: 12, minWidth: 56 }}>
        <Box sx={{ fontWeight: 700, color: 'primary.main' }}><ChordName name={name} /></Box>
      </Box>
    )
  }

  const { baseFret, frets, fingers } = shape
  const strings = Math.max(2, frets.length)
  const maxFret = Math.max(0, ...frets.filter((f) => f > 0))
  const rows = Math.max(4, maxFret)
  const width = PAD_LEFT + (strings - 1) * STRING_GAP + PAD_RIGHT
  const boardBottom = BOARD_TOP + rows * FRET_GAP
  const stringX = (i: number) => PAD_LEFT + i * STRING_GAP

  return (
    <Box className="cp-diagram" sx={{ textAlign: 'center', color: 'text.primary', '& svg': { display: 'block', mx: 'auto' } }}>
      <Box sx={{ fontWeight: 700, fontSize: 12, color: 'primary.main', mb: 0.25 }}><ChordName name={name} /></Box>
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
          <line x1={stringX(0)} y1={BOARD_TOP} x2={stringX(strings - 1)} y2={BOARD_TOP} strokeWidth={2.2} />
        ) : (
          <text x={stringX(0) - 4} y={BOARD_TOP + FRET_GAP - 3} fontSize={7} stroke="none" fill="currentColor" textAnchor="end">
            {baseFret}
          </text>
        )}

        {/* fret lines */}
        {Array.from({ length: rows + 1 }, (_, j) => (
          <line key={`f${j}`} x1={stringX(0)} y1={BOARD_TOP + j * FRET_GAP} x2={stringX(strings - 1)} y2={BOARD_TOP + j * FRET_GAP} />
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
                  {fingers && (typeof fingers[i] === 'string' || Number(fingers[i]) > 0) && (
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
