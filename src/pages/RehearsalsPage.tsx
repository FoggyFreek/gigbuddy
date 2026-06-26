import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import RehearsalsTable from '../components/RehearsalsTable.tsx'
import RehearsalFormModal from '../components/RehearsalFormModal.tsx'
import SplitView from '../components/SplitView.tsx'
import { listRehearsals, setVote } from '../api/rehearsals.ts'
import { rehearsalShareUrl } from '../utils/shareUtils.ts'
import { useAuth } from '../contexts/authContext.ts'
import { usePermissions } from '../hooks/usePermissions.ts'
import type { Rehearsal, Id } from '../types/entities.ts'

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
  const { t } = useTranslation('rehearsals')
  const { user } = useAuth()
  const { canWritePlanning } = usePermissions()
  const navigate = useNavigate()
  const { id: selectedIdParam } = useParams()
  const selectedId = selectedIdParam ? Number(selectedIdParam) : null
  const [rehearsals, setRehearsals] = useState<Rehearsal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<{ mode: 'create' } | null>(null)

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

  return (
    <SplitView
      basePath="/rehearsals"
      outletContext={{
        onRehearsalUpdate: handleRehearsalUpdate,
        onRehearsalDelete: handleRehearsalDetailDelete,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 600,  flexGrow: 1  }}>
          {t($ => $.title)}
        </Typography>
        {canWritePlanning && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setModal({ mode: 'create' })}
          >
            {t($ => $.add)}
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
