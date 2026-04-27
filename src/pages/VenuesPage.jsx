import { useCallback, useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import VenuesTable from '../components/VenuesTable.jsx'
import VenueFormModal from '../components/VenueFormModal.jsx'
import VenueImportDialog from '../components/VenueImportDialog.jsx'
import { deleteVenue, listVenues } from '../api/venues.js'

export default function VenuesPage() {
  const [venues, setVenues] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modal, setModal] = useState(null) // null | { mode: 'create' } | { mode: 'edit', venueId: number }
  const [importOpen, setImportOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await listVenues()
      setVenues(data)
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

  async function handleDelete() {
    await deleteVenue(modal.venueId)
    setModal(null)
    load()
  }

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
        <Typography variant="h5" fontWeight={600} sx={{ flexGrow: 1 }}>
          Venues
        </Typography>
        <Button
          startIcon={<UploadFileIcon />}
          onClick={() => setImportOpen(true)}
        >
          Import CSV
        </Button>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setModal({ mode: 'create' })}
        >
          Add venue
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
        <VenuesTable
          venues={venues}
          onRowClick={(v) => setModal({ mode: 'edit', venueId: v.id })}
        />
      )}

      {modal && (
        <VenueFormModal
          mode={modal.mode}
          venueId={modal.venueId}
          onClose={handleClose}
          onDelete={handleDelete}
        />
      )}

      {importOpen && (
        <VenueImportDialog
          onClose={(reloaded) => {
            setImportOpen(false)
            if (reloaded) load()
          }}
        />
      )}
    </>
  )
}
