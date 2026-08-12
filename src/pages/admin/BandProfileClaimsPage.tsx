import { useCallback, useEffect, useState } from 'react'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import {
  listClaimQueue,
  listUnclaimedProfiles,
  approveClaim,
  rejectClaim,
} from '../../api/admin/bandProfileClaims.ts'
import type {
  AdminBandProfileClaim,
  AdminClaimProfileUser,
  AdminClaimSocials,
  AdminUnclaimedBandProfile,
} from '../../api/admin/bandProfileClaims.ts'
import type { ClaimStatus, Id } from '../../types/entities.ts'
import { useCompactLayout } from '../../hooks/useCompactLayout.ts'
import ListPagination from '../../components/shared/ListPagination.tsx'

const STATUS_COLOR: Record<ClaimStatus, 'warning' | 'success' | 'error'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
}

const PAGE_SIZE = 20
const UNCLAIMED_PAGE_SIZE = 25

const SOCIAL_LINKS: ReadonlyArray<{
  key: keyof AdminClaimSocials
  label: string
  href: (handle: string) => string
}> = [
  { key: 'instagram', label: 'Instagram', href: (handle) => `https://www.instagram.com/${handle.replace(/^@/, '')}` },
  { key: 'facebook', label: 'Facebook', href: (handle) => `https://www.facebook.com/${handle.replace(/^@/, '')}` },
  { key: 'tiktok', label: 'TikTok', href: (handle) => `https://www.tiktok.com/@${handle.replace(/^@/, '')}` },
  { key: 'youtube', label: 'YouTube', href: (handle) => `https://www.youtube.com/${handle}` },
  { key: 'spotify', label: 'Spotify', href: (handle) => `https://open.spotify.com/artist/${handle}` },
]

function ExternalLink({ label, href, value }: Readonly<{ label: string; href: string; value: string }>) {
  return (
    <Typography variant="body2">
      {label}:{' '}
      <Link
        aria-label={label}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        sx={{ overflowWrap: 'anywhere' }}
      >
        {value}
      </Link>
    </Typography>
  )
}

function ClaimingBandSocials({ socials }: Readonly<{ socials: AdminClaimSocials }>) {
  const links = SOCIAL_LINKS.flatMap((social) => {
    const handle = socials[social.key]?.trim()
    return handle ? [{ ...social, handle }] : []
  })

  return (
    <Box component="section" role="region" aria-label="Claiming band socials">
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Claiming band socials</Typography>
      {links.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>No social links added.</Typography>
      ) : (
        <Stack spacing={0.25}>
          {links.map((social) => (
            <ExternalLink
              key={social.key}
              label={social.label}
              href={social.href(social.handle)}
              value={social.handle}
            />
          ))}
        </Stack>
      )}
    </Box>
  )
}

function ClaimedProfileLinks({ claim }: Readonly<{ claim: AdminBandProfileClaim }>) {
  if (!claim.bandProfile) {
    return (
      <Box component="section" role="region" aria-label="Claimed profile links">
        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Claimed profile</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          This band profile no longer exists.
        </Typography>
      </Box>
    )
  }

  return (
    <Box component="section" role="region" aria-label="Claimed profile links">
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Claimed profile</Typography>
      <Stack spacing={0.25}>
        <Typography variant="body2">Country: {claim.bandProfile.countryCode.toUpperCase()}</Typography>
        {claim.bandProfile.spotifyUrl && (
          <ExternalLink label="Spotify" href={claim.bandProfile.spotifyUrl} value={claim.bandProfile.spotifyUrl} />
        )}
        {claim.bandProfile.websiteUrl && (
          <ExternalLink label="Website" href={claim.bandProfile.websiteUrl} value={claim.bandProfile.websiteUrl} />
        )}
        {claim.bandProfile.contactEmail && (
          <Typography variant="body2">
            Contact:{' '}
            <Link href={`mailto:${claim.bandProfile.contactEmail}`}>{claim.bandProfile.contactEmail}</Link>
          </Typography>
        )}
      </Stack>
    </Box>
  )
}

const PROFILE_USER_MEMBERSHIP: Record<
  NonNullable<AdminClaimProfileUser['requestingTenantMembership']>['status'],
  { label: string; color: 'success' | 'warning' | 'error' }
> = {
  approved: { label: 'Member of requesting band', color: 'success' },
  pending: { label: 'Membership pending', color: 'warning' },
  rejected: { label: 'Membership rejected', color: 'error' },
}

function ProfileUsers({ users }: Readonly<{ users: AdminClaimProfileUser[] }>) {
  return (
    <Box component="section" role="region" aria-label="Band profile users" sx={{ mb: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
        GigBuddy users of this profile ({users.length})
      </Typography>
      {users.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          No GigBuddy users currently use this profile.
        </Typography>
      ) : (
        <Stack spacing={0.75}>
          {users.map((user) => {
            const membership = user.requestingTenantMembership
              ? PROFILE_USER_MEMBERSHIP[user.requestingTenantMembership.status]
              : null
            return (
              <Box
                key={String(user.id)}
                sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1, rowGap: 0.5 }}
              >
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{user.name ?? user.email}</Typography>
                <Link variant="body2" href={`mailto:${user.email}`}>{user.email}</Link>
                <Chip
                  size="small"
                  variant={membership ? 'filled' : 'outlined'}
                  color={membership?.color ?? 'default'}
                  label={membership?.label ?? 'Not in requesting band'}
                />
              </Box>
            )
          })}
        </Stack>
      )}
    </Box>
  )
}

function displayUser(user: { email: string; name: string | null } | null) {
  return user?.name ?? user?.email ?? '—'
}

function formatDateTime(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function DecidedClaimsTable({
  claims,
  decision,
}: Readonly<{ claims: AdminBandProfileClaim[]; decision: 'approved' | 'rejected' }>) {
  const decisionLabel = decision === 'approved' ? 'Approved' : 'Rejected'
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table aria-label={`${decisionLabel} band profile claims`} size="small">
        <TableHead>
          <TableRow>
            <TableCell>Band</TableCell>
            <TableCell>Claimed by</TableCell>
            <TableCell>Claimed on</TableCell>
            <TableCell>Requested by</TableCell>
            <TableCell>Requested on</TableCell>
            <TableCell>{decisionLabel} by</TableCell>
            <TableCell>{decisionLabel} on</TableCell>
            <TableCell>Status</TableCell>
            <TableCell align="center">Information</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {claims.map((claim) => (
            <TableRow key={String(claim.id)} hover>
              <TableCell sx={{ fontWeight: 600 }}>{claim.bandProfileName}</TableCell>
              <TableCell>
                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                  <span>{claim.tenant.displayName}</span>
                  {claim.tenant.archived && <Chip size="small" color="error" label="archived" />}
                </Stack>
              </TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(claim.createdAt)}</TableCell>
              <TableCell>{displayUser(claim.requestedBy)}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(claim.createdAt)}</TableCell>
              <TableCell>{displayUser(claim.decidedBy)}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(claim.decidedAt)}</TableCell>
              <TableCell>
                <Chip size="small" color={STATUS_COLOR[claim.status]} label={claim.status} />
              </TableCell>
              <TableCell align="center">
                {claim.message && (
                  <Tooltip title={claim.message}>
                    <IconButton size="small" aria-label="Claim information">
                      <InfoOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

interface UnclaimedPageState {
  key: string
  items: AdminUnclaimedBandProfile[]
  total: number
}

function UnclaimedProfilesTable() {
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(UNCLAIMED_PAGE_SIZE)
  const [cursors, setCursors] = useState<Array<string | null>>([null])
  const [state, setState] = useState<UnclaimedPageState | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cursor = cursors[page]
  const pageKey = `${rowsPerPage}:${page}:${cursor ?? ''}`
  const loading = cursor !== undefined && state?.key !== pageKey
  const items = state?.key === pageKey ? state.items : []
  const total = state?.key === pageKey ? state.total : 0

  useEffect(() => {
    if (cursor === undefined) return

    let cancelled = false
    listUnclaimedProfiles({ limit: rowsPerPage, cursor })
      .then((res) => {
        if (cancelled) return
        setState({ key: pageKey, items: res.items, total: res.meta.total })
        setCursors((current) => {
          const next = [...current]
          next[page + 1] = res.meta.nextCursor
          return next
        })
        setError(null)
      })
      .catch((e) => {
        if (cancelled) return
        setState({ key: pageKey, items: [], total: 0 })
        setError(e instanceof Error ? e.message : String(e))
      })

    return () => { cancelled = true }
  }, [cursor, page, pageKey, rowsPerPage])

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
  }

  if (error) return <Typography sx={{ color: 'error.main' }}>{error}</Typography>
  if (items.length === 0) return <Alert severity="info">No unclaimed band profiles.</Alert>

  return (
    <Paper variant="outlined">
      <TableContainer>
        <Table aria-label="Unclaimed band profiles" size="small">
          <TableHead>
            <TableRow>
              <TableCell>Band profile</TableCell>
              <TableCell align="right">Member count</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((profile) => (
              <TableRow key={String(profile.id)} hover>
                <TableCell sx={{ fontWeight: 600 }}>{profile.name}</TableCell>
                <TableCell align="right">{profile.memberCount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <ListPagination
        count={total}
        page={page}
        rowsPerPage={rowsPerPage}
        rowsPerPageOptions={[25, 50, 100]}
        onPageChange={(_event, nextPage) => setPage(nextPage)}
        onRowsPerPageChange={(event) => {
          setRowsPerPage(Number(event.target.value))
          setPage(0)
          setCursors([null])
          setState(null)
        }}
      />
    </Paper>
  )
}

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
  const isCompact = useCompactLayout()
  type TabValue = ClaimStatus | 'unclaimed'
  const [tab, setTab] = useState<TabValue>('pending')
  const status: ClaimStatus | null = tab === 'unclaimed' ? null : tab
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
    if (status === null) return
    const claimStatus = status
    let cancelled = false
    listClaimQueue({ status: claimStatus, limit: PAGE_SIZE })
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
    if (!nextCursor || status === null) return
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

      <Tabs value={tab} onChange={(_e, next: TabValue) => setTab(next)}>
        <Tab value="pending" label="Pending" />
        <Tab value="approved" label="Approved" />
        <Tab value="rejected" label="Rejected" />
        <Tab value="unclaimed" label="Unclaimed" />
      </Tabs>

      {status === null && <UnclaimedProfilesTable />}

      {status !== null && error && <Typography sx={{ color: 'error.main' }}>{error}</Typography>}

      {status !== null && loading && claims.length === 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      )}

      {status !== null && !loading && claims.length === 0 && (
        <Alert severity="info">No {status} claims.</Alert>
      )}

      {status !== null && claims.length > 0 && (status !== 'pending' && !isCompact ? (
        <DecidedClaimsTable claims={claims} decision={status} />
      ) : claims.map((claim) => (
        <Paper key={String(claim.id)} variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
            <Typography variant="h6" sx={{ flexGrow: 1 }}>{claim.bandProfileName}</Typography>
            <Chip size="small" color={STATUS_COLOR[claim.status]} label={claim.status} />
          </Stack>

          <Typography variant="body2" sx={{ mb: 1 }}>
            Claimed by <strong>{claim.tenant.displayName}</strong> ({claim.tenant.slug})
            {claim.tenant.archived && <Chip size="small" color="error" label="archived" sx={{ ml: 1 }} />}
          </Typography>

          {claim.requestedBy && (
            <Typography variant="body2" sx={{ mb: 2 }}>
              Requested by {claim.requestedBy.name && <strong>{claim.requestedBy.name}</strong>}
              {claim.requestedBy.name && ' · '}
              <Link href={`mailto:${claim.requestedBy.email}`}>{claim.requestedBy.email}</Link>
            </Typography>
          )}

          {/* Keep the claimant and global profile adjacent so reviewers can
              spot matching handles without switching pages. */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: isCompact ? '1fr' : 'repeat(2, minmax(0, 1fr))',
              gap: 2,
              mb: 2,
            }}
          >
            <ClaimingBandSocials socials={claim.tenant.socials} />
            <ClaimedProfileLinks claim={claim} />
          </Box>

          <ProfileUsers users={claim.profileUsers} />

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
      )))}

      {status !== null && nextCursor && (
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
