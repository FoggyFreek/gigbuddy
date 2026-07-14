import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import Tooltip from '@mui/material/Tooltip'
import AddIcon from '@mui/icons-material/Add'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import SplitView from '../components/SplitView.tsx'
import VenuesTable from '../components/VenuesTable.tsx'
import VenueFormModal from '../components/VenueFormModal.tsx'
import VenueImportDialog from '../components/VenueImportDialog.tsx'
import { listVenues } from '../api/venues.ts'
import type { Venue, Id } from '../types/entities.ts'

export default function VenuesPage() {
  const { t } = useTranslation(['venues', 'common'])
  const navigate = useNavigate()
  const { id: selectedIdParam } = useParams()
  const selectedId = selectedIdParam ? Number(selectedIdParam) : null
  const [venues, setVenues] = useState<Venue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<{ mode: 'create' } | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await listVenues()
      setVenues(data as Venue[])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const handleVenueUpdate = useCallback((id: Id, patch: Partial<Venue>) => {
    setVenues((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)))
  }, [])

  const handleVenueDelete = useCallback((id: Id) => {
    setVenues((prev) => prev.filter((v) => v.id !== id))
  }, [])

  useEffect(() => { load() }, [load])

  function handleClose() {
    setModal(null)
    load()
  }

  return (
    <SplitView
      basePath="/venues"
      outletContext={{ onVenueUpdate: handleVenueUpdate, onVenueDelete: handleVenueDelete }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
        <Typography variant="h5" sx={{ fontWeight: 600,  flexGrow: 1  }}>
          {t($ => $.title)}
        </Typography>
        <Tooltip title={t($ => $.importTooltip)}>
          <IconButton onClick={() => setImportOpen(true)}>
            <UploadFileIcon />
          </IconButton>
        </Tooltip>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setModal({ mode: 'create' })}
        >
          {t($ => $.common.actions.add)}
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
          onRowClick={(v) => navigate(`/venues/${v.id}`)}
          selectedId={selectedId}
        />
      )}

      {modal && (
        <VenueFormModal
          mode="create"
          onClose={handleClose}
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
    </SplitView>
  )
}
