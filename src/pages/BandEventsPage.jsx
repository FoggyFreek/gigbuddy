import { useCallback, useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import BandEventsTable from '../components/BandEventsTable.jsx'
import BandEventFormModal from '../components/BandEventFormModal.jsx'
import { deleteBandEvent, listBandEvents } from '../api/bandEvents.js'

export default function BandEventsPage() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modal, setModal] = useState(null) // null | { mode: 'create' } | { mode: 'edit', bandEventId: number }
  const [confirmDelete, setConfirmDelete] = useState(null) // null | event object

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await listBandEvents()
      setEvents(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function handleClose() {
    setModal(null)
    load()
  }

  function handleDelete(event) {
    setConfirmDelete(event)
  }

  async function handleConfirmDelete() {
    await deleteBandEvent(confirmDelete.id)
    setConfirmDelete(null)
    load()
  }

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={600} sx={{ flexGrow: 1 }}>
          Band Events
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setModal({ mode: 'create' })}
        >
          Add event
        </Button>
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {error && (
        <Typography color="error" sx={{ mb: 2 }}>
          {error}
        </Typography>
      )}

      {!loading && (
        <BandEventsTable
          events={events}
          onRowClick={(e) => setModal({ mode: 'edit', bandEventId: e.id })}
          onDelete={handleDelete}
        />
      )}

      {modal && (
        <BandEventFormModal
          mode={modal.mode}
          bandEventId={modal.bandEventId}
          onClose={handleClose}
        />
      )}

      <Dialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)}>
        <DialogTitle>Delete event?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {confirmDelete && (
              <>
                Delete &ldquo;{confirmDelete.title || 'this event'}&rdquo;? This cannot be undone.
              </>
            )}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleConfirmDelete}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
