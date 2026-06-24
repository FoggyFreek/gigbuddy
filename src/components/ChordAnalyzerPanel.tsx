import { useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import ClearIcon from '@mui/icons-material/Clear'
import InteractiveFretboard from './InteractiveFretboard.tsx'
import { identifyChords, type AbsoluteFret } from '../utils/chordIdentify.ts'

// Read-only chord *finder*: place fingers on the neck, see which chord name(s)
// those notes spell (top guess + alternates, the sounding notes, and the
// interval breakdown), like oolimo's analyzer. It never reads or writes the
// chart source — purely a reference tool.
const ALL_MUTED: AbsoluteFret[] = [-1, -1, -1, -1, -1, -1]

interface ChordAnalyzerPanelProps {
  fretCount?: number
}

export default function ChordAnalyzerPanel({ fretCount = 15 }: ChordAnalyzerPanelProps) {
  const [frets, setFrets] = useState<AbsoluteFret[]>(ALL_MUTED)

  const candidates = useMemo(() => identifyChords(frets), [frets])
  const [best, ...alternates] = candidates
  const anyFingered = frets.some((f) => f !== -1)

  return (
    <Stack spacing={1.5}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="subtitle2" color="text.secondary">
          Place fingers on the neck to identify the chord
        </Typography>
        <Button
          size="small"
          startIcon={<ClearIcon fontSize="small" />}
          onClick={() => setFrets(ALL_MUTED)}
          disabled={!anyFingered}
        >
          Clear
        </Button>
      </Box>

      <Box sx={{ overflowX: 'auto' }}>
        <InteractiveFretboard frets={frets} onChange={setFrets} fretCount={fretCount} />
      </Box>

      <Box aria-live="polite" sx={{ minHeight: 64 }}>
        {!best ? (
          <Typography variant="body2" color="text.secondary">
            {anyFingered ? 'No recognized chord.' : 'No notes selected.'}
          </Typography>
        ) : (
          <Stack spacing={1}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, flexWrap: 'wrap' }}>
              <Typography variant="h4" sx={{ fontWeight: 700, color: 'primary.main' }}>
                {best.name}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {best.notes.join(' · ')}
              </Typography>
            </Box>

            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
              {best.intervals.map((label) => (
                <Chip key={label} label={label} size="small" variant="outlined" />
              ))}
            </Stack>

            {alternates.length > 0 && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="caption" color="text.secondary">
                  Also:
                </Typography>
                {alternates.map((c) => (
                  <Chip key={c.name} label={c.name} size="small" />
                ))}
              </Box>
            )}
          </Stack>
        )}
      </Box>
    </Stack>
  )
}
