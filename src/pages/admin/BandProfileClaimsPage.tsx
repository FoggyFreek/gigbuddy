import { useCallback, useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import {
  listClaimQueue,
  approveClaim,
  rejectClaim,
} from '../../api/admin/bandProfileClaims.ts'
import type { AdminBandProfileClaim } from '../../api/admin/bandProfileClaims.ts'
import type { ClaimStatus, Id } from '../../types/entities.ts'

const STATUS_COLOR: Record<ClaimStatus, 'warning' | 'success' | 'error'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
}

const PAGE_SIZE = 20

/**
 * Band-profile claims awaiting review.
 *
 * The verification itself happens outside gigbuddy — email from the band's
 * domain, proof of ownership, whatever satisfies the reviewer — so this page
 * shows what a decision needs and records the outcome. Approving hands the
 * global profile to the band; rejecting always carries a reason, because the
 * band has to act on it.
 *
 * Admin copy is hardcoded English, matching the other pages under /admin.
 */
export default function BandProfileClaimsPage() {
  const [status, setStatus] = useState<ClaimStatus>('pending')
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<Id | null>(null)
  const [rejecting, setRejecting] = useState<AdminBandProfileClaim | null>(null)
  const [reason, setReason] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)

  const [reloadNonce, setReloadNonce] = useState(0)
  const reload = useCallback(() => setReloadNonce((n) => n + 1), [])

  // The page is tagged with the feed it answered, so `loading` is derived
  // rather than a flag flipped from inside the effect.
  interface QueueState { key: string; items: AdminBandProfileClaim[]; nextCursor: string | null }
  const [state, setState] = useState<QueueState | null>(null)
  const feedKey = `${status}:${reloadNonce}`
  const loading = state?.key !== feedKey
  const claims = state?.key === feedKey ? state.items : []
  const nextCursor = state?.key === feedKey ? state.nextCursor : null

  useEffect(() => {
    let cancelled = false
    listClaimQueue({ status, limit: PAGE_SIZE })
      .then((res) => {
        if (cancelled) return
        setState({ key: feedKey, items: res.items, nextCursor: res.meta.nextCursor })
        setError(null)
      })
      .catch((e) => {
        if (cancelled) return
        setState({ key: feedKey, items: [], nextCursor: null })
        setError(e instanceof Error ? e.message : String(e))
      })
    return () => { cancelled = true }
  }, [status, feedKey])

  // Keyset paging: the cursor carries the full instant, so claims made on the
  // same day page correctly.
  async function loadMore() {
    if (!nextCursor) return
    setLoadingMore(true)
    try {
      const res = await listClaimQueue({ status, limit: PAGE_SIZE, cursor: nextCursor })
      setState((prev) => (prev?.key === feedKey
        ? { key: feedKey, items: [...prev.items, ...res.items], nextCursor: res.meta.nextCursor }
        : prev))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingMore(false)
    }
  }

  async function handleApprove(claim: AdminBandProfileClaim) {
    setBusyId(claim.id)
    setError(null)
    try {
      await approveClaim(claim.id)
      reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  async function handleReject() {
    if (!rejecting || !reason.trim()) return
    setBusyId(rejecting.id)
    setError(null)
    try {
      await rejectClaim(rejecting.id, reason.trim())
      setRejecting(null)
      setReason('')
      reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Typography variant="h5" sx={{ fontWeight: 600 }}>Band profile claims</Typography>

      <Tabs value={status} onChange={(_e, next: ClaimStatus) => setStatus(next)}>
        <Tab value="pending" label="Pending" />
        <Tab value="approved" label="Approved" />
        <Tab value="rejected" label="Rejected" />
      </Tabs>

      {error && <Typography color="error">{error}</Typography>}

      {loading && claims.length === 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      )}

      {!loading && claims.length === 0 && (
        <Alert severity="info">No {status} claims.</Alert>
      )}

      {claims.map((claim) => (
        <Paper key={String(claim.id)} variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
            <Typography variant="h6" sx={{ flexGrow: 1 }}>{claim.bandProfileName}</Typography>
            <Chip size="small" color={STATUS_COLOR[claim.status]} label={claim.status} />
          </Stack>

          <Typography variant="body2" sx={{ mb: 1 }}>
            Claimed by <strong>{claim.tenant.displayName}</strong> ({claim.tenant.slug})
            {claim.tenant.archived && <Chip size="small" color="error" label="archived" sx={{ ml: 1 }} />}
            {claim.requestedBy && ` · requested by ${claim.requestedBy.name ?? claim.requestedBy.email}`}
          </Typography>

          {/* What the reviewer verifies against. Absent once the profile has
              been deleted, which the name snapshot above covers. */}
          {claim.bandProfile ? (
            <Stack spacing={0.25} sx={{ mb: 1 }}>
              <Typography variant="body2">Country: {claim.bandProfile.countryCode.toUpperCase()}</Typography>
              {claim.bandProfile.spotifyUrl && (
                <Typography variant="body2">
                  Spotify: <Link href={claim.bandProfile.spotifyUrl} target="_blank" rel="noopener noreferrer">
                    {claim.bandProfile.spotifyUrl}
                  </Link>
                </Typography>
              )}
              {claim.bandProfile.websiteUrl && (
                <Typography variant="body2">
                  Website: <Link href={claim.bandProfile.websiteUrl} target="_blank" rel="noopener noreferrer">
                    {claim.bandProfile.websiteUrl}
                  </Link>
                </Typography>
              )}
              {claim.bandProfile.contactEmail && (
                <Typography variant="body2">Contact: {claim.bandProfile.contactEmail}</Typography>
              )}
            </Stack>
          ) : (
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
              This band profile no longer exists.
            </Typography>
          )}

          {/* Free text from an unverified claimant — rendered as plain text,
              never as markup. */}
          {claim.message && (
            <Alert severity="info" sx={{ mb: 1 }}>{claim.message}</Alert>
          )}
          {claim.decisionReason && (
            <Alert severity="warning" sx={{ mb: 1 }}>{claim.decisionReason}</Alert>
          )}

          {claim.status === 'pending' && (
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                variant="contained"
                color="success"
                disabled={busyId === claim.id}
                onClick={() => handleApprove(claim)}
              >
                Approve
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="error"
                disabled={busyId === claim.id}
                onClick={() => { setRejecting(claim); setReason('') }}
              >
                Reject
              </Button>
            </Stack>
          )}
        </Paper>
      ))}

      {nextCursor && (
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <Button disabled={loadingMore} onClick={loadMore}>Load more</Button>
        </Box>
      )}

      <Dialog open={rejecting !== null} fullWidth maxWidth="xs" onClose={() => setRejecting(null)}>
        <DialogTitle>Reject this claim?</DialogTitle>
        <DialogContent>
          <TextField
            label="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            helperText="Shown to the band, so they know what to fix."
            multiline
            minRows={2}
            fullWidth
            autoFocus
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejecting(null)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            disabled={!reason.trim() || busyId !== null}
            onClick={handleReject}
          >
            Reject
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
