import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import BandEventsTable, { type BandEventsTab } from '../components/BandEventsTable.tsx'
import BandEventFormModal from '../components/BandEventFormModal.tsx'
import SplitView from '../components/SplitView.tsx'
import { listPastBandEvents, listUpcomingBandEvents } from '../api/bandEvents.ts'
import { bandEventShareUrl } from '../utils/shareUtils.ts'
import { isPastDate, localDateString } from '../utils/dateFormat.ts'
import type { ListCollectionCursor } from '../types/api.ts'
import type { BandEvent } from '../types/entities.ts'

const TAB_PAGE_SIZE = 100

export default function BandEventsPage() {
  const { t } = useTranslation(['bandEvents', 'common'])
  const navigate = useNavigate()
  const { id: selectedIdParam } = useParams()
  const selectedId = selectedIdParam ? Number(selectedIdParam) : null

  const [activeTab, setActiveTab] = useState<BandEventsTab>('upcoming')
  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab
  const [events, setEvents] = useState<BandEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [pastCursor, setPastCursor] = useState<ListCollectionCursor | null>(null)
  const [pastHasMore, setPastHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<{ mode: 'create' } | null>(null)
  const deferInitialTabLoadRef = useRef(selectedIdParam != null)
  const requestIdRef = useRef(0)

  const loadTab = useCallback(async (tab: BandEventsTab) => {
    const requestId = ++requestIdRef.current
    try {
      setLoading(true)
      setError(null)
      const today = localDateString()
      if (tab === 'upcoming') {
        const result = await listUpcomingBandEvents(TAB_PAGE_SIZE, today)
        if (requestIdRef.current !== requestId) return
        setEvents(result.items)
        setPastCursor(null)
        setPastHasMore(false)
      } else {
        const result = await listPastBandEvents(TAB_PAGE_SIZE, today)
        if (requestIdRef.current !== requestId) return
        setEvents(result.items)
        setPastCursor(result.meta.nextCursor)
        setPastHasMore(result.meta.nextCursor !== null)
      }
    } catch (e: unknown) {
      if (requestIdRef.current === requestId) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (requestIdRef.current === requestId) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (deferInitialTabLoadRef.current) return
    loadTab(activeTab)
  }, [activeTab, loadTab])

  const handleDetailLoaded = useCallback((event: BandEvent) => {
    const wasDeferred = deferInitialTabLoadRef.current
    deferInitialTabLoadRef.current = false
    const tab: BandEventsTab = isPastDate(event.end_date || event.start_date) ? 'past' : 'upcoming'
    if (tab === activeTabRef.current) {
      if (wasDeferred) loadTab(tab)
    } else {
      setActiveTab(tab)
    }
  }, [loadTab])

  const handleDetailLoadError = useCallback(() => {
    if (!deferInitialTabLoadRef.current) return
    deferInitialTabLoadRef.current = false
    loadTab(activeTabRef.current)
  }, [loadTab])

  function handleClose() {
    setModal(null)
    loadTab(activeTabRef.current)
  }

  const handleBandEventUpdate = useCallback((id: number, patch: Partial<BandEvent>) => {
    setEvents((previous) => previous.map((event) => event.id === id ? { ...event, ...patch } : event))
    if ('start_date' in patch || 'end_date' in patch) loadTab(activeTabRef.current)
  }, [loadTab])

  const handleBandEventDetailDelete = useCallback((id: number) => {
    setEvents((previous) => previous.filter((event) => event.id !== id))
  }, [])

  async function handleLoadMorePast() {
    if (!pastCursor || loadingMore) return
    const requestId = requestIdRef.current
    try {
      setLoadingMore(true)
      const result = await listPastBandEvents(TAB_PAGE_SIZE, localDateString(), pastCursor)
      if (requestIdRef.current !== requestId || activeTabRef.current !== 'past') return
      setEvents((previous) => [...previous, ...result.items])
      setPastCursor(result.meta.nextCursor)
      setPastHasMore(result.meta.nextCursor !== null)
    } catch (e: unknown) {
      if (requestIdRef.current === requestId) setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingMore(false)
    }
  }

  const outletContext = useMemo(() => ({
    onBandEventUpdate: handleBandEventUpdate,
    onBandEventDelete: handleBandEventDetailDelete,
    onBandEventDetailLoaded: handleDetailLoaded,
    onBandEventDetailLoadError: handleDetailLoadError,
  }), [handleBandEventUpdate, handleBandEventDetailDelete, handleDetailLoaded, handleDetailLoadError])

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
        hasMore={pastHasMore}
        loadingMore={loadingMore}
        onLoadMore={handleLoadMorePast}
      />

      {modal && <BandEventFormModal mode="create" onClose={handleClose} />}
    </SplitView>
  )
}
