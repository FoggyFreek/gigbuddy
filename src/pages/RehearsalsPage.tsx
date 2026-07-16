import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import FilterListIcon from '@mui/icons-material/FilterList'
import RehearsalsTable, { type RehearsalsTab } from '../components/RehearsalsTable.tsx'
import RehearsalFormModal from '../components/RehearsalFormModal.tsx'
import SplitView from '../components/SplitView.tsx'
import { listPastRehearsals, listUpcomingRehearsals, setVote } from '../api/rehearsals.ts'
import { rehearsalShareUrl } from '../utils/shareUtils.ts'
import { useAuth } from '../contexts/authContext.ts'
import { usePermissions } from '../hooks/usePermissions.ts'
import { isPastDate, localDateString } from '../utils/dateFormat.ts'
import type { ListCollectionCursor } from '../types/api.ts'
import type { Rehearsal, Id } from '../types/entities.ts'

const REHEARSAL_STATUSES = ['planned', 'option'] as const
const TAB_PAGE_SIZE = 100

function applyVoteToRehearsals(rehearsals: Rehearsal[], rehearsalId: Id, memberId: Id, vote: string): Rehearsal[] {
  return rehearsals.map((rehearsal) => {
    if (rehearsal.id !== rehearsalId) return rehearsal
    const participants = (rehearsal.participants ?? []).map((participant) =>
      participant.band_member_id === memberId ? { ...participant, vote } : participant,
    )
    return { ...rehearsal, participants }
  })
}

export default function RehearsalsPage() {
  const { t } = useTranslation(['rehearsals', 'common'])
  const { user } = useAuth()
  const { canWritePlanning } = usePermissions()
  const navigate = useNavigate()
  const { id: selectedIdParam } = useParams()
  const selectedId = selectedIdParam ? Number(selectedIdParam) : null

  const [activeTab, setActiveTab] = useState<RehearsalsTab>('upcoming')
  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab
  const [rehearsals, setRehearsals] = useState<Rehearsal[]>([])
  const [loading, setLoading] = useState(true)
  const [pastCursor, setPastCursor] = useState<ListCollectionCursor | null>(null)
  const [pastHasMore, setPastHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<{ mode: 'create' } | null>(null)
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(
    () => new Set(REHEARSAL_STATUSES),
  )
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null)
  const deferInitialTabLoadRef = useRef(selectedIdParam != null)
  const requestIdRef = useRef(0)

  const loadTab = useCallback(async (tab: RehearsalsTab) => {
    const requestId = ++requestIdRef.current
    try {
      setLoading(true)
      setError(null)
      const today = localDateString()
      if (tab === 'upcoming') {
        const result = await listUpcomingRehearsals(TAB_PAGE_SIZE, today)
        if (requestIdRef.current !== requestId) return
        setRehearsals(result.items)
        setPastCursor(null)
        setPastHasMore(false)
      } else {
        const result = await listPastRehearsals(TAB_PAGE_SIZE, today)
        if (requestIdRef.current !== requestId) return
        setRehearsals(result.items)
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

  const handleDetailLoaded = useCallback((rehearsal: Rehearsal) => {
    const wasDeferred = deferInitialTabLoadRef.current
    deferInitialTabLoadRef.current = false
    const tab: RehearsalsTab = isPastDate(rehearsal.proposed_date) ? 'past' : 'upcoming'
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

  async function handleVote(rehearsalId: Id | undefined, memberId: Id | undefined, vote: string | null) {
    if (rehearsalId === undefined || memberId === undefined || vote === null) return
    await setVote(rehearsalId, memberId, vote)
    setRehearsals((previous) => applyVoteToRehearsals(previous, rehearsalId, memberId, vote))
  }

  const handleRehearsalUpdate = useCallback((id: Id, patch: Partial<Rehearsal>) => {
    setRehearsals((previous) => previous.map((rehearsal) => (
      rehearsal.id === id ? { ...rehearsal, ...patch } : rehearsal
    )))
    if ('proposed_date' in patch) loadTab(activeTabRef.current)
  }, [loadTab])

  const handleRehearsalDetailDelete = useCallback((id: Id) => {
    setRehearsals((previous) => previous.filter((rehearsal) => rehearsal.id !== id))
  }, [])

  async function handleLoadMorePast() {
    if (!pastCursor || loadingMore) return
    const requestId = requestIdRef.current
    try {
      setLoadingMore(true)
      const result = await listPastRehearsals(TAB_PAGE_SIZE, localDateString(), pastCursor)
      if (requestIdRef.current !== requestId || activeTabRef.current !== 'past') return
      setRehearsals((previous) => [...previous, ...result.items])
      setPastCursor(result.meta.nextCursor)
      setPastHasMore(result.meta.nextCursor !== null)
    } catch (e: unknown) {
      if (requestIdRef.current === requestId) setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingMore(false)
    }
  }

  function toggleStatus(status: string) {
    setSelectedStatuses((previous) => {
      const next = new Set(previous)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  }

  function toggleAllStatuses() {
    setSelectedStatuses((previous) =>
      previous.size === REHEARSAL_STATUSES.length ? new Set() : new Set(REHEARSAL_STATUSES),
    )
  }

  const allStatusesSelected = selectedStatuses.size === REHEARSAL_STATUSES.length
  const someStatusesSelected = selectedStatuses.size > 0 && !allStatusesSelected
  const outletContext = useMemo(() => ({
    onRehearsalUpdate: handleRehearsalUpdate,
    onRehearsalDelete: handleRehearsalDetailDelete,
    onRehearsalDetailLoaded: handleDetailLoaded,
    onRehearsalDetailLoadError: handleDetailLoadError,
  }), [handleRehearsalUpdate, handleRehearsalDetailDelete, handleDetailLoaded, handleDetailLoadError])

  return (
    <SplitView basePath="/rehearsals" outletContext={outletContext}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 0.5 }}>
        <Typography variant="h5" sx={{ fontWeight: 600, flexGrow: 1 }}>
          {t($ => $.title)}
        </Typography>
        <Tooltip title={t($ => $.table.filterRehearsals)}>
          <IconButton
            aria-label={t($ => $.table.filterRehearsals)}
            color={someStatusesSelected ? 'primary' : 'default'}
            onClick={(event) => setFilterAnchor(event.currentTarget)}
          >
            <FilterListIcon />
          </IconButton>
        </Tooltip>
        <Menu anchorEl={filterAnchor} open={Boolean(filterAnchor)} onClose={() => setFilterAnchor(null)}>
          <MenuItem dense onClick={toggleAllStatuses}>
            <Checkbox size="small" checked={allStatusesSelected} indeterminate={someStatusesSelected} />
            <ListItemText primary={t($ => $.table.allStatuses)} />
          </MenuItem>
          <Divider />
          {REHEARSAL_STATUSES.map((status) => (
            <MenuItem key={status} dense onClick={() => toggleStatus(status)}>
              <Checkbox size="small" checked={selectedStatuses.has(status)} />
              <ListItemText primary={t($ => $.status[status])} />
            </MenuItem>
          ))}
        </Menu>
        {canWritePlanning && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setModal({ mode: 'create' })}>
            {t($ => $.actions.add, { ns: 'common' })}
          </Button>
        )}
      </Box>

      {error && <Typography color="error" sx={{ mb: 2 }}>{error}</Typography>}

      <RehearsalsTable
        rehearsals={rehearsals}
        loading={loading}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        selectedStatuses={selectedStatuses}
        bandMemberId={user?.bandMemberId}
        onVote={handleVote}
        onRowClick={(rehearsal) => navigate(`/rehearsals/${rehearsal.id}`)}
        onShare={(rehearsal) => window.open(rehearsalShareUrl(rehearsal), '_blank')}
        selectedId={selectedId}
        hasMore={pastHasMore}
        loadingMore={loadingMore}
        onLoadMore={handleLoadMorePast}
      />

      {modal && <RehearsalFormModal mode="create" onClose={handleClose} />}
    </SplitView>
  )
}
