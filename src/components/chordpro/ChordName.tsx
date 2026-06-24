import Box from '@mui/material/Box'
import { splitChordSymbol } from '../../utils/chordSymbol.ts'

// Renders a chord symbol with its quality superscripted (Bb7(b9) -> Bb⁷⁽ᵇ⁹⁾):
// the root (note + accidental + a minor m) and any slash bass sit on the
// baseline, the quality/extensions ride up in a <sup>. Shared by every React
// surface that shows a chord name (analyzer, diagrams, grid cells); the
// chords-over-lyrics HTML path mirrors this in chordpro.ts so screen and PDF agree.
interface ChordNameProps {
  name: string
}

// line-height:0 keeps the raised quality from stretching the line box.
const supSx = { fontSize: '0.7em', lineHeight: 0, verticalAlign: 'super' } as const

export default function ChordName({ name }: ChordNameProps) {
  const { base, sup, bass } = splitChordSymbol(name)
  return (
    <>
      {base}
      {sup && <Box component="sup" sx={supSx}>{sup}</Box>}
      {bass !== null && `/${bass}`}
    </>
  )
}
