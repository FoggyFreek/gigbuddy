import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import BandEventsTable from '../components/BandEventsTable.tsx'
import BandEventFormModal from '../components/BandEventFormModal.tsx'
import SplitView from '../components/SplitView.tsx'
import { usePagedEventTabs } from '../hooks/usePagedEventTabs.ts'
import { usePlanningSource } from '../hooks/usePlanningSource.ts'
import { bandEventShareUrl } from '../utils/shareUtils.ts'
import type { BandEvent } from '../types/entities.ts'

export default function BandEventsPage() {
  const { t } = useTranslation(['bandEvents', 'common'])
  const eventSource = usePlanningSource('bandEvents')
  const navigate = useNavigate()
  const { id: selectedIdParam } = useParams()
  const selectedId = selectedIdParam ? Number(selectedIdParam) : null

  const [modal, setModal] = useState<{ mode: 'create' } | null>(null)
  const {
    activeTab, setActiveTab,
    items: events, setItems: setEvents,
    loading, loadingMore, hasMore, error,
    reload, loadMore, onDetailLoaded, onDetailLoadError,
  } = usePagedEventTabs({
    aggregate: 'bandEvents',
    dateOf: (event) => event.end_date || event.start_date,
    deferInitialLoad: selectedIdParam != null,
  })

  function handleClose() {
    setModal(null)
    reload()
  }

  const handleBandEventUpdate = useCallback((id: number, patch: Partial<BandEvent>) => {
    setEvents((previous) => previous.map((event) => event.id === id ? { ...event, ...patch } : event))
    if ('start_date' in patch || 'end_date' in patch) reload()
  }, [setEvents, reload])

  const handleBandEventDetailDelete = useCallback((id: number) => {
    setEvents((previous) => previous.filter((event) => event.id !== id))
  }, [setEvents])

  const outletContext = useMemo(() => ({
    onBandEventUpdate: handleBandEventUpdate,
    onBandEventDelete: handleBandEventDetailDelete,
    onBandEventDetailLoaded: onDetailLoaded,
    onBandEventDetailLoadError: onDetailLoadError,
  }), [handleBandEventUpdate, handleBandEventDetailDelete, onDetailLoaded, onDetailLoadError])

  return (
    <SplitView basePath="/events" outletContext={outletContext}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 600, flexGrow: 1 }}>
          {t($ => $.title)}
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setModal({ mode: 'create' })}>
          {t($ => $.actions.add, { ns: 'common' })}
        </Button>
      </Box>

      {error && <Typography color="error" sx={{ mb: 2 }}>{error}</Typography>}

      <BandEventsTable
        events={events}
        loading={loading}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onRowClick={(event) => navigate(`/events/${event.id}`)}
        onShare={(event) => window.open(bandEventShareUrl(event), '_blank')}
        selectedId={selectedId ?? undefined}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={loadMore}
        showBand={eventSource.labelsTenant}
      />

      {modal && <BandEventFormModal mode="create" onClose={handleClose} />}
    </SplitView>
  )
}
