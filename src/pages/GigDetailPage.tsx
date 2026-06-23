import { useEffect, useRef, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CloseIcon from '@mui/icons-material/Close'
import GigDetailContent from '../components/GigDetailContent.tsx'
import GigShareMenu from '../components/GigShareMenu.tsx'
import PastEventAlert from '../components/PastEventAlert.tsx'
import SaveStatusLabel from '../components/SaveStatusLabel.tsx'
import { deleteGig } from '../api/gigs.ts'
import { usePermissions } from '../hooks/usePermissions.ts'
import type { Gig, Id } from '../types/entities.ts'

export default function GigDetailPage() {
  const { id } = useParams()
  const gigId = Number(id)
  const { canWritePlanning } = usePermissions()
  const navigate = useNavigate()
  const outletCtx = (useOutletContext() || {}) as Record<string, unknown>
  const insideSplitView = !!outletCtx.insideSplitView

  const contentRef = useRef<{ saveStatus: string; flush: () => Promise<void> }>(null)
  const [polledStatus, setPolledStatus] = useState('idle')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [gig, setGig] = useState<Gig | null>(null)

  useEffect(() => {
    const interval = setInterval(() => {
      setPolledStatus(contentRef.current?.saveStatus ?? 'idle')
    }, 100)
    return () => clearInterval(interval)
  }, [])

  async function handleBack() {
    await contentRef.current?.flush()
    if (typeof outletCtx.onClose === 'function') outletCtx.onClose()
    else navigate(-1)
  }

  return (
    <Box sx={{ maxWidth: insideSplitView ? '100%' : 800, mx: insideSplitView ? 0 : 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        {!insideSplitView && (
          <IconButton onClick={handleBack} aria-label="back">
            <ArrowBackIcon />
          </IconButton>
        )}
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          {gig?.id === gigId ? (gig.event_description || 'Gig details') : 'Gig details'}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        {/* Identity gate: the lifted gig lags during async loads / split-view id
            changes, so only share once it matches the current id. */}
        {gig?.id === gigId && <GigShareMenu gig={gig} />}
        {insideSplitView && (
          <IconButton onClick={handleBack} aria-label="close">
            <CloseIcon />
          </IconButton>
        )}
      </Box>

      {gig?.id === gigId && <PastEventAlert date={gig.event_date} />}

      <GigDetailContent
        ref={contentRef}
        gigId={gigId}
        canWrite={canWritePlanning}
        onBannerUpdate={outletCtx.onGigUpdate as ((gigId: Id, patch: Record<string, unknown>) => void) | undefined}
        onGigLoaded={setGig as (gig: Gig) => void}
      />

      <Box sx={{ mt: 2, display: 'flex', alignItems: 'center' }}>
        <SaveStatusLabel status={polledStatus} />
      </Box>

      {canWritePlanning && (
        <Box sx={{ mt: 4 }}>
          <Button color="error" variant="contained" onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        </Box>
      )}

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>Delete gig?</DialogTitle>
        <DialogContent>
          <DialogContentText>This cannot be undone.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={async () => {
              setConfirmDelete(false)
              await deleteGig(gigId)
              if (typeof outletCtx.onGigDelete === 'function') outletCtx.onGigDelete(gigId)
              if (typeof outletCtx.onClose === 'function') outletCtx.onClose()
              else navigate(-1)
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
