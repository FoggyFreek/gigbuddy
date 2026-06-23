import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import LibraryMusicIcon from '@mui/icons-material/LibraryMusic'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import ChordProViewerDialog from './ChordProViewerDialog.tsx'
import { createSongChart, deleteSongChart } from '../api/songs.ts'
import type { SongChart, Id } from '../types/entities.ts'

// ChordPro charts for a song: create a blank chart, then open each in the
// fullscreen viewer/editor (render + print-to-PDF). Importing a .pro file as a
// new song lives in the Songs page Import menu. Owns the chart list so
// adds/edits/deletes stay in sync without a refetch.
interface ChordProChartsSectionProps {
  songId: Id
  initialCharts?: SongChart[]
  canWrite?: boolean
}

export default function ChordProChartsSection({
  songId,
  initialCharts = [],
  canWrite = true,
}: ChordProChartsSectionProps) {
  const [charts, setCharts] = useState<SongChart[]>(initialCharts)
  const [openId, setOpenId] = useState<Id | null>(null)
  const [startInEdit, setStartInEdit] = useState(false)
  const [confirmId, setConfirmId] = useState<Id | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openChart = charts.find((c) => c.id === openId) ?? null
  const confirmTarget = charts.find((c) => c.id === confirmId)

  function openViewer(id: Id, edit: boolean) {
    setStartInEdit(edit)
    setOpenId(id)
  }

  async function handleNew() {
    setError(null)
    setBusy(true)
    try {
      const chart = await createSongChart(songId, { name: 'New chart', source: '' })
      setCharts((prev) => [...prev, chart])
      openViewer(chart.id as Id, true)
    } catch (err) {
      setError((err as Error).message || 'Could not create chart.')
    } finally {
      setBusy(false)
    }
  }

  function handleChartChange(updated: SongChart) {
    setCharts((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
  }

  async function handleConfirmDelete() {
    const id = confirmId
    setConfirmId(null)
    if (id === null) return
    setError(null)
    try {
      await deleteSongChart(songId, id)
      setCharts((prev) => prev.filter((c) => c.id !== id))
    } catch (err) {
      setError((err as Error).message || 'Delete failed.')
    }
  }

  return (
    <Stack spacing={1}>
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ py: 0 }}>
          {error}
        </Alert>
      )}

      {charts.map((c) => (
        <Box
          key={String(c.id)}
          sx={{ px: 1.5, py: 0.75, borderRadius: 1, border: '1px solid', borderColor: 'divider', bgcolor: 'action.hover' }}
        >
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <LibraryMusicIcon fontSize="small" color="action" />
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Link
                component="button"
                type="button"
                underline="hover"
                color="text.primary"
                onClick={() => openViewer(c.id as Id, false)}
                sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, textAlign: 'left' }}
              >
                {c.name || 'Chart'}
              </Link>
            </Box>
            {canWrite && (
              <IconButton size="small" color="error" onClick={() => setConfirmId(c.id ?? null)} aria-label="delete chart">
                <DeleteIcon fontSize="small" />
              </IconButton>
            )}
          </Stack>
        </Box>
      ))}

      {canWrite && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <AddIcon />}
            disabled={busy}
            onClick={handleNew}
          >
            New chart
          </Button>
        </Box>
      )}

      {openChart && (
        <ChordProViewerDialog
          key={String(openChart.id)}
          open
          songId={songId}
          chart={openChart}
          canWrite={canWrite}
          startInEdit={startInEdit}
          onClose={() => setOpenId(null)}
          onChartChange={handleChartChange}
        />
      )}

      <Dialog open={confirmId !== null} onClose={() => setConfirmId(null)}>
        <DialogTitle>Delete chart?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {confirmTarget?.name || 'This chart'} will be permanently deleted.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmId(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleConfirmDelete}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
