import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import ClearIcon from '@mui/icons-material/Clear'
import LibraryAddIcon from '@mui/icons-material/LibraryAdd'
import InteractiveFretboard from './InteractiveFretboard.tsx'
import ChordName from './ChordName.tsx'
import { identifyChords, absoluteFretsToChordShape, type AbsoluteFret } from '../../utils/chordIdentify.ts'
import { formatChordDefinition } from '../../utils/chordpro.ts'

// Read-only chord *finder*: place fingers on the neck, see which chord name(s)
// those notes spell (top guess + alternates, the sounding notes, and the
// interval breakdown), like oolimo's analyzer. When `onAddToChart` is supplied
// (edit-capable viewers) it can also emit the top chord as a {define} directive
// — the identified name plus this exact voicing — for insertion into the source.
const ALL_MUTED: AbsoluteFret[] = [-1, -1, -1, -1, -1, -1]

interface ChordAnalyzerPanelProps {
  fretCount?: number
  // Insert the top chord and its current voicing into the chart as a {define}.
  // Omitted for read-only viewers; the finder then stays purely a reference tool.
  onAddToChart?: (name: string, directive: string) => void
}

export default function ChordAnalyzerPanel({ fretCount = 15, onAddToChart }: Readonly<ChordAnalyzerPanelProps>) {
  const { t } = useTranslation('songs')
  const [frets, setFrets] = useState<AbsoluteFret[]>(ALL_MUTED)

  const candidates = useMemo(() => identifyChords(frets), [frets])
  const [best, ...alternates] = candidates
  const anyFingered = frets.some((f) => f !== -1)

  return (
    <Stack spacing={1.5}>
      <Box  sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="subtitle2" color="text.secondary">
          {t($ => $.analyzer.prompt)}
        </Typography>
        <Button
          size="small"
          startIcon={<ClearIcon fontSize="small" />}
          onClick={() => setFrets(ALL_MUTED)}
          disabled={!anyFingered}
        >
          {t($ => $.analyzer.clear)}
        </Button>
      </Box>

      <Box sx={{ overflowX: 'auto' }}>
        <InteractiveFretboard frets={frets} onChange={setFrets} fretCount={fretCount} />
      </Box>

      <Box aria-live="polite" sx={{ minHeight: 64 }}>
        {!best ? (
          <Typography variant="body2" color="text.secondary">
            {anyFingered ? t($ => $.analyzer.noChord) : t($ => $.analyzer.noNotes)}
          </Typography>
        ) : (
          <Stack spacing={1}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, flexWrap: 'wrap' }}>
              <Typography variant="h4" sx={{ fontWeight: 700, color: 'primary.main' }}>
                <ChordName name={best.name} />
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {best.notes.join(' · ')}
              </Typography>
              {onAddToChart && (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<LibraryAddIcon fontSize="small" />}
                  onClick={() => onAddToChart(best.name, formatChordDefinition(best.name, absoluteFretsToChordShape(frets)))}
                  sx={{ alignSelf: 'center', ml: 'auto' }}
                >
                  {t($ => $.analyzer.addToChart)}
                </Button>
              )}
            </Box>

            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
              {best.intervals.map((label) => (
                <Chip key={label} label={label} size="small" variant="outlined" />
              ))}
            </Stack>

            {alternates.length > 0 && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="caption" color="text.secondary">
                  {t($ => $.analyzer.also)}
                </Typography>
                {alternates.map((c) => (
                  <Chip key={c.name} label={<ChordName name={c.name} />} size="small" />
                ))}
              </Box>
            )}
          </Stack>
        )}
      </Box>
    </Stack>
  )
}
