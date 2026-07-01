import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Collapse from '@mui/material/Collapse'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Paper from '@mui/material/Paper'
import TextField from '@mui/material/TextField'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import CloseIcon from '@mui/icons-material/Close'
import DeleteIcon from '@mui/icons-material/Delete'
import PrintIcon from '@mui/icons-material/Print'
import EditIcon from '@mui/icons-material/Edit'
import VisibilityIcon from '@mui/icons-material/Visibility'
import AddIcon from '@mui/icons-material/Add'
import RemoveIcon from '@mui/icons-material/Remove'
import MusicNoteIcon from '@mui/icons-material/MusicNote'
import GraphicEqIcon from '@mui/icons-material/GraphicEq'
import ChordProView from './ChordProView.tsx'
import ChordAnalyzerPanel from './ChordAnalyzerPanel.tsx'
import SaveStatusLabel from '../SaveStatusLabel.tsx'
import useDebouncedSave from '../../hooks/useDebouncedSave.ts'
import { useToast } from '../../contexts/toastContext.ts'
import { printChordPro, MONO_FONT } from '../../utils/chordpro.ts'
import { updateSongChart } from '../../api/songs.ts'
import type { SongChart, Id } from '../../types/entities.ts'

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
  onDelete?: () => Promise<void>
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
  onDelete,
}: Readonly<ChordProViewerDialogProps>) {
  const { t } = useTranslation(['songs', 'common'])
  const showToast = useToast()
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
  // Read-only chord finder (fingers -> chord name); never touches the source.
  const [showAnalyzer, setShowAnalyzer] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
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

  // Append a chord {define} built by the chord finder to the source, so its
  // custom voicing is registered for the chart. Flip to the editor so the new
  // line is visible and can be tweaked.
  function handleAddDefine(chordName: string, directive: string) {
    const base = source.replace(/\s*$/, '')
    handleSource(base ? `${base}\n${directive}\n` : `${directive}\n`)
    setEditing(true)
    showToast?.(t($ => $.viewer.chordAdded, { name: chordName }), 'success')
  }

  async function handleClose() {
    await flush()
    onClose()
  }

  async function handleDeleteConfirm() {
    setConfirmDelete(false)
    await onDelete?.()
    onClose()
  }

  const editor = (
    <Paper elevation={2} sx={{ p: 2, height: '100%', minHeight: 0 }}>
      <TextField
        label={t($ => $.viewer.source)}
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
    </Paper>
  )

  const preview = (
    <Paper elevation={2} sx={{ p: 3, height: '100%', overflow: 'auto' }}>
      <Box ref={viewRef}>
        <ChordProView source={source} transposeOffset={transposeOffset} />
      </Box>
    </Paper>
  )

  const transposeControl = (
    <Box sx={{ display: 'flex', alignItems: 'center' }}>
      <Tooltip title={t($ => $.viewer.transposeDown)}>
        <IconButton size="small" onClick={() => bumpTranspose(-1)} aria-label={t($ => $.viewer.transposeDownAria)}>
          <RemoveIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title={transposeOffset === 0 ? t($ => $.viewer.transpose) : t($ => $.viewer.resetTranspose)}>
        <Button
          size="small"
          color="inherit"
          onClick={() => setTransposeOffset(0)}
          startIcon={<MusicNoteIcon fontSize="small" />}
          sx={{ minWidth: 56, fontVariantNumeric: 'tabular-nums' }}
          aria-label={t($ => $.viewer.transposeResetAria, { n: transposeOffset })}
        >
          {transposeOffset > 0 ? `+${transposeOffset}` : transposeOffset}
        </Button>
      </Tooltip>
      <Tooltip title={t($ => $.viewer.transposeUp)}>
        <IconButton size="small" onClick={() => bumpTranspose(1)} aria-label={t($ => $.viewer.transposeUpAria)}>
          <AddIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  )

  const chordFinderButton = (
    <Tooltip title={t($ => $.viewer.chordFinder)}>
      <IconButton
        size="small"
        onClick={() => setShowAnalyzer((v) => !v)}
        aria-label={t($ => $.viewer.toggleChordFinder)}
        aria-pressed={showAnalyzer}
        color={showAnalyzer ? 'primary' : 'default'}
      >
        <GraphicEqIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  )

  return (
    <Dialog fullScreen open={open} onClose={handleClose} slotProps={{ paper: { elevation: 0 } }}>
      <AppBar position="sticky" color="default" elevation={1}>
        {/* Row 1: title + primary actions */}
        <Toolbar sx={{ gap: 1 }}>
          <IconButton edge="start" onClick={handleClose} aria-label={t($ => $.common.actions.close)}>
            <CloseIcon />
          </IconButton>
          {editing ? (
            <TextField
              size="small"
              variant="standard"
              value={name}
              onChange={(e) => handleName(e.target.value)}
              placeholder={t($ => $.viewer.chartNamePlaceholder)}
              sx={{ flexGrow: 1, maxWidth: 360 }}
            />
          ) : (
            <Typography variant="h6" sx={{ flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {name || t($ => $.charts.chartFallback)}
            </Typography>
          )}
          <Box sx={{ flexGrow: 1 }} />
          {/* desktop only: transpose + chord finder stay in the single row */}
          {!stacked && (
            <>
              {chordFinderButton}
              {transposeControl}
            </>
          )}
          <SaveStatusLabel status={status} />
          {canWrite && (
            <Button
              startIcon={editing ? <VisibilityIcon /> : <EditIcon />}
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? t($ => $.preview) : t($ => $.common.actions.edit)}
            </Button>
          )}
          <Button variant="contained" startIcon={<PrintIcon />} onClick={handlePrint}>
            {t($ => $.viewer.print)}
          </Button>
          {onDelete && (
            <Tooltip title={t($ => $.viewer.deleteChart)}>
              <IconButton color="error" onClick={() => setConfirmDelete(true)} aria-label={t($ => $.viewer.deleteChart)}>
                <DeleteIcon />
              </IconButton>
            </Tooltip>
          )}
        </Toolbar>

        {/* Row 2 (compact only): transpose + chord finder */}
        {stacked && (
          <Toolbar variant="dense" sx={{ gap: 1, borderTop: '1px solid', borderColor: 'divider' }}>
            {transposeControl}
            {chordFinderButton}
          </Toolbar>
        )}
      </AppBar>

      <Collapse in={showAnalyzer} unmountOnExit sx={{ flexShrink: 0 }}>
        <Paper variant="outlined" square sx={{ p: { xs: 1.5, md: 2 }, borderWidth: '0 0 1px 0'  }}>
          <ChordAnalyzerPanel fretCount={stacked ? 7 : 15} onAddToChart={canWrite ? handleAddDefine : undefined} />
        </Paper>
      </Collapse>

      <Box sx={{ flexGrow: 1, minHeight: 0, p: { xs: 1.5, md: 3 }, overflow: 'auto' }}>
        {editing ? (
          stacked ? (
            <Box sx={{ height: '100%', minHeight: 280 }}>{editor}</Box>
          ) : (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 2,
                height: '100%',
                minHeight: 280,
              }}
            >
              <Box sx={{ height: '100%', minHeight: 0 }}>{editor}</Box>
              {preview}
            </Box>
          )
        ) : (
          <Box sx={{ maxWidth: 800, mx: 'auto' }}>
            <Paper elevation={2} sx={{ p: { xs: 2, md: 4 } }}>
              <Box ref={viewRef}>
                <ChordProView source={source} transposeOffset={transposeOffset} />
              </Box>
            </Paper>
          </Box>
        )}
      </Box>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>{t($ => $.viewer.deleteTitle)}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t($ => $.viewer.deleteBody, { name: name || t($ => $.viewer.deleteThisChart) })}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>{t($ => $.common.actions.cancel)}</Button>
          <Button color="error" variant="contained" onClick={handleDeleteConfirm}>{t($ => $.common.actions.delete)}</Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  )
}
