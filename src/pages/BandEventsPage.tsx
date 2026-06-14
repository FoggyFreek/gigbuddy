import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import BandEventsTable from '../components/BandEventsTable.tsx'
import BandEventFormModal from '../components/BandEventFormModal.tsx'
import SplitView from '../components/SplitView.tsx'
import { listBandEvents } from '../api/bandEvents.ts'
import { bandEventShareUrl } from '../utils/shareUtils.ts'
import type { BandEvent } from '../types/entities.ts'

export default function BandEventsPage() {
  const navigate = useNavigate()
  const { id: selectedIdParam } = useParams()
  const selectedId = selectedIdParam ? Number(selectedIdParam) : null
  const [events, setEvents] = useState<BandEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<{ mode: 'create' } | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await listBandEvents()
      setEvents(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function handleClose() {
    setModal(null)
    load()
  }

  const handleBandEventUpdate = useCallback((id: number, patch: Partial<BandEvent>) => {
    setEvents((prev) => prev.map((ev) => (ev.id === id ? { ...ev, ...patch } : ev)))
  }, [])

  const handleBandEventDetailDelete = useCallback((id: number) => {
    setEvents((prev) => prev.filter((ev) => ev.id !== id))
  }, [])

  return (
    <SplitView
      basePath="/events"
      outletContext={{
        onBandEventUpdate: handleBandEventUpdate,
        onBandEventDelete: handleBandEventDetailDelete,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 600, flexGrow: 1 }}>
          Band Events
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setModal({ mode: 'create' })}
        >
          Add
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
          onRowClick={(e) => navigate(`/events/${e.id}`)}
          onShare={(e) => window.open(bandEventShareUrl(e), '_blank')}
          selectedId={selectedId ?? undefined}
        />
      )}

      {modal && (
        <BandEventFormModal
          mode="create"
          onClose={handleClose}
        />
      )}
    </SplitView>
  )
}
