import { useCallback, useRef, useState } from 'react'
import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import Paper from '@mui/material/Paper'
import TextField from '@mui/material/TextField'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import CloseIcon from '@mui/icons-material/Close'
import PrintIcon from '@mui/icons-material/Print'
import EditIcon from '@mui/icons-material/Edit'
import VisibilityIcon from '@mui/icons-material/Visibility'
import AddIcon from '@mui/icons-material/Add'
import RemoveIcon from '@mui/icons-material/Remove'
import MusicNoteIcon from '@mui/icons-material/MusicNote'
import ChordProView from './ChordProView.tsx'
import SaveStatusLabel from './SaveStatusLabel.tsx'
import useDebouncedSave from '../hooks/useDebouncedSave.ts'
import { printChordPro, MONO_FONT } from '../utils/chordpro.ts'
import { updateSongChart } from '../api/songs.ts'
import type { SongChart, Id } from '../types/entities.ts'

// Fullscreen detail screen for one ChordPro chart: renders it (chords over
// lyrics), prints/saves it as PDF via the browser print dialog, and — for users
// who can edit — flips to a source editor, with a side-by-side live preview on
// wider screens. Edits auto-save (debounced); name/source changes propagate to
// the parent via onChartChange.
interface ChordProViewerDialogProps {
  open: boolean
  songId: Id
  chart: SongChart
  canWrite: boolean
  startInEdit?: boolean
  onClose: () => void
  onChartChange: (chart: SongChart) => void
}

type ChartPatch = { name?: string; source?: string }

export default function ChordProViewerDialog({
  open,
  songId,
  chart,
  canWrite,
  startInEdit = false,
  onClose,
  onChartChange,
}: ChordProViewerDialogProps) {
  const theme = useTheme()
  const stacked = useMediaQuery(theme.breakpoints.down('md'))
  const chartId = chart.id as Id

  const [name, setName] = useState(chart.name ?? '')
  const [source, setSource] = useState(chart.source ?? '')
  const [editing, setEditing] = useState(startInEdit && canWrite)
  // Interactive transpose (semitones) layered on top of any {transpose} in the
  // source — view-only, never written back to the chart. Clamped to ±12.
  const [transposeOffset, setTransposeOffset] = useState(0)
  const bumpTranspose = (delta: number) => setTransposeOffset((n) => Math.max(-12, Math.min(12, n + delta)))
  // Print clones the live rendered DOM (incl. abcjs SVGs) into the print window.
  const viewRef = useRef<HTMLDivElement | null>(null)

  function handlePrint() {
    printChordPro(viewRef.current?.innerHTML ?? null, source, name)
  }

  const saveFn = useCallback(
    async (patch: ChartPatch) => {
      const updated = await updateSongChart(songId, chartId, patch)
      onChartChange(updated)
    },
    [songId, chartId, onChartChange],
  )
  const { schedule, flush, status } = useDebouncedSave<ChartPatch>(saveFn)

  function handleName(value: string) {
    setName(value)
    if (value.trim()) schedule({ name: value.trim() })
  }

  function handleSource(value: string) {
    setSource(value)
    schedule({ source: value })
  }

  async function handleClose() {
    await flush()
    onClose()
  }

  const editor = (
    <TextField
      label="ChordPro source"
      value={source}
      onChange={(e) => handleSource(e.target.value)}
      multiline
      fullWidth
      slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: MONO_FONT, fontSize: 14, lineHeight: 1.5, resize: 'none', overflow: 'auto' } } }}
      sx={{
        height: '100%',
        minHeight: 0,
        '& .MuiInputBase-root': { height: '100%', minHeight: 0, alignItems: 'stretch', boxSizing: 'border-box' },
        // The autosizing textarea grows past the box with overflow:hidden inline;
        // pin it to the field height and let it scroll instead.
        '& .MuiInputBase-inputMultiline, & textarea': {
          height: '100% !important',
          overflow: 'auto !important',
          resize: 'none',
          boxSizing: 'border-box',
        },
      }}
    />
  )

  const preview = (
    <Paper variant="outlined" sx={{ p: 3, height: '100%', overflow: 'auto' }}>
      <Box ref={viewRef}>
        <ChordProView source={source} transposeOffset={transposeOffset} />
      </Box>
    </Paper>
  )

  const transposeControl = (
    <Box sx={{ display: 'flex', alignItems: 'center' }}>
      <Tooltip title="Transpose down a semitone">
        <IconButton size="small" onClick={() => bumpTranspose(-1)} aria-label="transpose down">
          <RemoveIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title={transposeOffset === 0 ? 'Transpose' : 'Reset transpose'}>
        <Button
          size="small"
          color="inherit"
          onClick={() => setTransposeOffset(0)}
          startIcon={<MusicNoteIcon fontSize="small" />}
          sx={{ minWidth: 56, fontVariantNumeric: 'tabular-nums' }}
          aria-label={`transpose ${transposeOffset} semitones, reset`}
        >
          {transposeOffset > 0 ? `+${transposeOffset}` : transposeOffset}
        </Button>
      </Tooltip>
      <Tooltip title="Transpose up a semitone">
        <IconButton size="small" onClick={() => bumpTranspose(1)} aria-label="transpose up">
          <AddIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  )

  return (
    <Dialog fullScreen open={open} onClose={handleClose}>
      <AppBar position="sticky" color="default" elevation={1}>
        <Toolbar sx={{ gap: 1 }}>
          <IconButton edge="start" onClick={handleClose} aria-label="close">
            <CloseIcon />
          </IconButton>
          {editing ? (
            <TextField
              size="small"
              variant="standard"
              value={name}
              onChange={(e) => handleName(e.target.value)}
              placeholder="Chart name"
              sx={{ flexGrow: 1, maxWidth: 360 }}
            />
          ) : (
            <Typography variant="h6" sx={{ flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {name || 'Chart'}
            </Typography>
          )}
          <Box sx={{ flexGrow: 1 }} />
          {transposeControl}
          <SaveStatusLabel status={status} />
          {canWrite && (
            <Button
              startIcon={editing ? <VisibilityIcon /> : <EditIcon />}
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? 'Preview' : 'Edit'}
            </Button>
          )}
          <Button variant="contained" startIcon={<PrintIcon />} onClick={handlePrint}>
            Print
          </Button>
        </Toolbar>
      </AppBar>

      <Box sx={{ flexGrow: 1, p: { xs: 1.5, md: 3 }, overflow: 'auto' }}>
        {editing ? (
          stacked ? (
            <Box sx={{ height: 'calc(100vh - 112px)', minHeight: 280 }}>{editor}</Box>
          ) : (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 2,
                height: 'calc(100vh - 112px)',
              }}
            >
              <Box sx={{ height: '100%', minHeight: 0 }}>{editor}</Box>
              {preview}
            </Box>
          )
        ) : (
          <Box sx={{ maxWidth: 800, mx: 'auto' }}>
            <Paper variant="outlined" sx={{ p: { xs: 2, md: 4 } }}>
              <Box ref={viewRef}>
                <ChordProView source={source} transposeOffset={transposeOffset} />
              </Box>
            </Paper>
          </Box>
        )}
      </Box>
    </Dialog>
  )
}
