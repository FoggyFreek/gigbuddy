import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
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
import RehearsalsTable from './components/RehearsalsTable.tsx'
import RehearsalFormModal from './components/RehearsalFormModal.tsx'
import SplitView from '../../components/SplitView.tsx'
import { setVote } from './rehearsals.ts'
import { setMyRehearsalVote } from '../availability/me.ts'
import { rehearsalShareUrl } from '../../promotion/sharing/shareUtils.ts'
import { useAuth } from '../../contexts/authContext.ts'
import { usePagedEventTabs } from '../shared/usePagedEventTabs.ts'
import { usePlanningSource } from '../shared/usePlanningSource.ts'
import { usePermissions } from '../../hooks/usePermissions.ts'
import type { Rehearsal, Id } from '../../types/entities.ts'
import type { MaybeCrossTenant } from '../../types/api.ts'

const REHEARSAL_STATUSES = ['planned', 'option'] as const

function applyVoteToRehearsals(
  rehearsals: MaybeCrossTenant<Rehearsal>[],
  rehearsalId: Id,
  memberId: Id,
  vote: string,
): MaybeCrossTenant<Rehearsal>[] {
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
  const rehearsalSource = usePlanningSource('rehearsals')
  const navigate = useNavigate()
  const { id: selectedIdParam } = useParams()
  const selectedId = selectedIdParam ? Number(selectedIdParam) : null

  const [modal, setModal] = useState<{ mode: 'create' } | null>(null)
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(
    () => new Set(REHEARSAL_STATUSES),
  )
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null)
  const {
    activeTab, setActiveTab,
    items: rehearsals, setItems: setRehearsals,
    loading, loadingMore, hasMore, error,
    reload, loadMore, onDetailLoaded, onDetailLoadError,
  } = usePagedEventTabs({
    aggregate: 'rehearsals',
    dateOf: (rehearsal) => rehearsal.proposed_date,
    deferInitialLoad: selectedIdParam != null,
  })

  function handleClose() {
    setModal(null)
    reload()
  }

  async function handleVote(rehearsalId: Id | undefined, memberId: Id | undefined, vote: string | null) {
    if (rehearsalId === undefined || memberId === undefined || vote === null) return
    // Hub rows aren't reachable through the tenant-scoped vote endpoint; voting
    // on your own attendance is the one write /api/me offers instead.
    if (rehearsalSource.canWriteOrdinaryEndpoint) await setVote(rehearsalId, memberId, vote)
    else await setMyRehearsalVote(rehearsalId, vote)
    setRehearsals((previous) => applyVoteToRehearsals(previous, rehearsalId, memberId, vote))
  }

  const handleRehearsalUpdate = useCallback((id: Id, patch: Partial<Rehearsal>) => {
    setRehearsals((previous) => previous.map((rehearsal) => (
      rehearsal.id === id ? { ...rehearsal, ...patch } : rehearsal
    )))
    if ('proposed_date' in patch) reload()
  }, [setRehearsals, reload])

  const handleRehearsalDetailDelete = useCallback((id: Id) => {
    setRehearsals((previous) => previous.filter((rehearsal) => rehearsal.id !== id))
  }, [setRehearsals])

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
    onRehearsalDetailLoaded: onDetailLoaded,
    onRehearsalDetailLoadError: onDetailLoadError,
  }), [handleRehearsalUpdate, handleRehearsalDetailDelete, onDetailLoaded, onDetailLoadError])

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
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={loadMore}
        showBand={rehearsalSource.labelsTenant}
      />

      {modal && <RehearsalFormModal mode="create" onClose={handleClose} />}
    </SplitView>
  )
}
