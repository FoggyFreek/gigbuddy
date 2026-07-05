import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import FilterListIcon from '@mui/icons-material/FilterList'
import RehearsalsTable from '../components/RehearsalsTable.tsx'
import RehearsalFormModal from '../components/RehearsalFormModal.tsx'
import SplitView from '../components/SplitView.tsx'
import { listRehearsals, setVote } from '../api/rehearsals.ts'
import { rehearsalShareUrl } from '../utils/shareUtils.ts'
import { useAuth } from '../contexts/authContext.ts'
import { usePermissions } from '../hooks/usePermissions.ts'
import type { Rehearsal, Id } from '../types/entities.ts'

const REHEARSAL_STATUSES = ['planned', 'option'] as const

function applyVoteToRehearsals(rehearsals: Rehearsal[], rehearsalId: Id, memberId: Id, vote: string): Rehearsal[] {
  return rehearsals.map((r) => {
    if (r.id !== rehearsalId) return r
    const participants = (r.participants ?? []).map((p) =>
      p.band_member_id === memberId ? { ...p, vote } : p,
    )
    return { ...r, participants }
  })
}

export default function RehearsalsPage() {
  const { t } = useTranslation(['rehearsals', 'common'])
  const { user } = useAuth()
  const { canWritePlanning } = usePermissions()
  const navigate = useNavigate()
  const { id: selectedIdParam } = useParams()
  const selectedId = selectedIdParam ? Number(selectedIdParam) : null
  const [rehearsals, setRehearsals] = useState<Rehearsal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<{ mode: 'create' } | null>(null)
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(
    () => new Set(REHEARSAL_STATUSES),
  )
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await listRehearsals()
      setRehearsals(data as Rehearsal[])
    } catch (e: unknown) {
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

  async function handleVote(rehearsalId: Id | undefined, memberId: Id | undefined, vote: string | null) {
    if (rehearsalId === undefined || memberId === undefined || vote === null) return
    await setVote(rehearsalId, memberId, vote)
    setRehearsals((prev) => applyVoteToRehearsals(prev, rehearsalId, memberId, vote))
  }

  const handleRehearsalUpdate = useCallback((id: Id, patch: Partial<Rehearsal>) => {
    setRehearsals((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }, [])

  const handleRehearsalDetailDelete = useCallback((id: Id) => {
    setRehearsals((prev) => prev.filter((r) => r.id !== id))
  }, [])

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

  return (
    <SplitView
      basePath="/rehearsals"
      outletContext={{
        onRehearsalUpdate: handleRehearsalUpdate,
        onRehearsalDelete: handleRehearsalDetailDelete,
      }}
    >
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
        <Menu
          anchorEl={filterAnchor}
          open={Boolean(filterAnchor)}
          onClose={() => setFilterAnchor(null)}
        >
          <MenuItem dense onClick={toggleAllStatuses}>
            <Checkbox
              size="small"
              checked={allStatusesSelected}
              indeterminate={someStatusesSelected}
            />
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
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setModal({ mode: 'create' })}
          >
            {t($ => $.actions.add, { ns: 'common' })}
          </Button>
        )}
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
        <RehearsalsTable
          rehearsals={rehearsals}
          selectedStatuses={selectedStatuses}
          bandMemberId={user?.bandMemberId}
          onVote={handleVote}
          onRowClick={(r) => navigate(`/rehearsals/${r.id}`)}
          onShare={(r) => window.open(rehearsalShareUrl(r), '_blank')}
          selectedId={selectedId}
        />
      )}

      {modal && (
        <RehearsalFormModal
          mode="create"
          onClose={handleClose}
        />
      )}
    </SplitView>
  )
}
