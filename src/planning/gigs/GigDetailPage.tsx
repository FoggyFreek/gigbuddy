import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CloseIcon from '@mui/icons-material/Close'
import GigDetailContent, { type TabKey } from './components/gigdetails/GigDetailContent.tsx'
import GigShareMenu from './components/gigdetails/GigShareMenu.tsx'
import PastEventAlert from '../../components/PastEventAlert.tsx'
import SaveStatusLabel from '../../components/SaveStatusLabel.tsx'
import { deleteGig } from './gigs.ts'
import { usePermissions } from '../../hooks/usePermissions.ts'
import { useDialog } from '../../contexts/dialogContext.ts'
import type { Gig, Id } from '../../types/entities.ts'
import type { MaybeCrossTenant } from '../../types/api.ts'
import { useCrossTenantRow } from '../shared/useCrossTenantRow.ts'

export default function GigDetailPage() {
  const { t } = useTranslation(['gigs', 'common'])
  const { confirmDelete } = useDialog()
  const { id } = useParams()
  const gigId = Number(id)
  const { canWritePlanning } = usePermissions()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const TAB_KEYS: TabKey[] = ['event', 'terms', 'participants', 'tasks']
  const tabParam = searchParams.get('tab')
  const initialTab = TAB_KEYS.find((k) => k === tabParam) ?? 'event'
  const outletCtx = (useOutletContext() || {}) as Record<string, unknown>
  const insideSplitView = !!outletCtx.insideSplitView

  const contentRef = useRef<{ saveStatus: string; flush: () => Promise<void> }>(null)
  const [polledStatus, setPolledStatus] = useState('idle')
  const [gig, setGig] = useState<MaybeCrossTenant<Gig> | null>(null)

  // The lifted gig lags during async loads / split-view id changes, so a gig
  // that isn't this page's yet says nothing about which band owns it.
  const loaded = gig?.id === gigId
  const { isCrossBand, canWrite: detailCanWrite } = useCrossTenantRow(loaded ? gig : null)

  // Report the gig this pane just fetched back up to the list page (e.g. so
  // it can pick the Upcoming/Past tab from the gig's date) instead of the
  // list page making its own, redundant getGig() call for the same id.
  const onGigDetailLoaded = outletCtx.onGigDetailLoaded as ((gig: MaybeCrossTenant<Gig>) => void) | undefined
  const onGigDetailLoadError = outletCtx.onGigDetailLoadError as (() => void) | undefined
  const handleGigLoaded = useCallback((g: MaybeCrossTenant<Gig>) => {
    setGig(g)
    onGigDetailLoaded?.(g)
  }, [onGigDetailLoaded])

  useEffect(() => {
    const interval = setInterval(() => {
      setPolledStatus(contentRef.current?.saveStatus ?? 'idle')
    }, 100)
    return () => clearInterval(interval)
  }, [])

  async function handleDelete() {
    if (!await confirmDelete({ title: t($ => $.page.deleteConfirmTitle) })) return
    await deleteGig(gigId)
    if (typeof outletCtx.onGigDelete === 'function') outletCtx.onGigDelete(gigId)
    if (typeof outletCtx.onClose === 'function') outletCtx.onClose()
    else navigate(-1)
  }

  async function handleBack() {
    await contentRef.current?.flush()
    if (typeof outletCtx.onClose === 'function') outletCtx.onClose()
    else navigate(-1)
  }

  return (
    <Box sx={{ maxWidth: insideSplitView ? '100%' : 800, mx: insideSplitView ? 0 : 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        {!insideSplitView && (
          <IconButton onClick={handleBack} aria-label={t($ => $.aria.back, { ns: 'common' })}>
            <ArrowBackIcon />
          </IconButton>
        )}
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          {loaded ? (gig.event_description || t($ => $.page.titleFallback)) : t($ => $.page.titleFallback)}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        {/* Identity gate: the lifted gig lags during async loads / split-view id
            changes, so only share once it matches the current id. Sharing is a
            tenant-scoped write, so a cross-band gig doesn't get it at all. */}
        {loaded && !isCrossBand && <GigShareMenu gig={gig} />}
        {insideSplitView && (
          <IconButton onClick={handleBack} aria-label={t($ => $.aria.close, { ns: 'common' })}>
            <CloseIcon />
          </IconButton>
        )}
      </Box>

      {loaded && <PastEventAlert date={gig.event_date} />}

      <GigDetailContent
        ref={contentRef}
        gigId={gigId}
        canWrite={canWritePlanning}
        initialTab={initialTab}
        onBannerUpdate={outletCtx.onGigUpdate as ((gigId: Id, patch: Record<string, unknown>) => void) | undefined}
        onGigLoaded={handleGigLoaded}
        onGigLoadError={onGigDetailLoadError}
      />

      {detailCanWrite && (
        <Box sx={{ mt: 2, display: 'flex', alignItems: 'center' }}>
          <SaveStatusLabel status={polledStatus} />
        </Box>
      )}

      {detailCanWrite && (
        <Box sx={{ mt: 4 }}>
          <Button color="error" variant="contained" onClick={() => { void handleDelete() }}>
            {t($ => $.actions.delete, { ns: 'common' })}
          </Button>
        </Box>
      )}

    </Box>
  )
}
