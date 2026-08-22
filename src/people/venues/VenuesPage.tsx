import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import Tooltip from '@mui/material/Tooltip'
import AddIcon from '@mui/icons-material/Add'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import SplitView from '../../components/SplitView.tsx'
import VenuesTable from './components/VenuesTable.tsx'
import VenueFormModal from './components/VenueFormModal.tsx'
import VenueImportDialog from './components/VenueImportDialog.tsx'
import VenueCampaignDialogContent from '../../promotion/outreach/components/VenueCampaignDialogContent.tsx'
import { useDialog } from '../../contexts/dialogContext.ts'
import { listVenues } from './venues.ts'
import type { Venue, Id } from '../../types/entities.ts'

export default function VenuesPage() {
  const { t } = useTranslation(['venues', 'common', 'outreach'])
  const navigate = useNavigate()
  const { closeDialog, showDialog } = useDialog()
  const { id: selectedIdParam } = useParams()
  const selectedId = selectedIdParam ? Number(selectedIdParam) : null
  const [modal, setModal] = useState<{ mode: 'create' } | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  // The fetched list is tagged with the reload it answered, so `loading` and
  // `error` are derived from whether the newest reload has landed — no flags an
  // effect has to flip synchronously before the request goes out.
  const [reloadNonce, setReloadNonce] = useState(0)
  const reload = useCallback(() => setReloadNonce((n) => n + 1), [])
  const [venuesState, setVenuesState] = useState<{ key: number; venues: Venue[]; error: string | null } | null>(null)
  const venues = venuesState?.venues ?? []
  const loading = venuesState?.key !== reloadNonce
  const error = venuesState?.key === reloadNonce ? venuesState.error : null

  useEffect(() => {
    let cancelled = false
    listVenues()
      .then((data) => {
        if (!cancelled) setVenuesState({ key: reloadNonce, venues: data as Venue[], error: null })
      })
      .catch((e: unknown) => {
        // Keep the rows already on screen; surface the failure alongside them.
        if (!cancelled) {
          setVenuesState((prev) => ({
            key: reloadNonce,
            venues: prev?.venues ?? [],
            error: e instanceof Error ? e.message : String(e),
          }))
        }
      })
    return () => { cancelled = true }
  }, [reloadNonce])

  const handleVenueUpdate = useCallback((id: Id, patch: Partial<Venue>) => {
    setVenuesState((prev) => (prev
      ? { ...prev, venues: prev.venues.map((v) => (v.id === id ? { ...v, ...patch } : v)) }
      : prev))
  }, [])

  const handleVenueDelete = useCallback((id: Id) => {
    setVenuesState((prev) => (prev ? { ...prev, venues: prev.venues.filter((v) => v.id !== id) } : prev))
  }, [])

  function handleClose() {
    setModal(null)
    reload()
  }

  function emailSelected(selected: Venue[]) {
    void showDialog({
      id: 'venue-email-campaign',
      title: t($ => $.outreach.venueDialog.title),
      body: <VenueCampaignDialogContent venues={selected} onClose={closeDialog} />,
      actions: [],
      maxWidth: 'md',
    })
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
          onEmailSelected={emailSelected}
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
            if (reloaded) reload()
          }}
        />
      )}
    </SplitView>
  )
}
