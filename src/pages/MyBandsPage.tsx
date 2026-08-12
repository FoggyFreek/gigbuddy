import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import MyBandsTable from '../components/myBands/MyBandsTable.tsx'
import AddBandDialog from '../components/myBands/AddBandDialog.tsx'
import BandProfileFormModal from '../components/myBands/BandProfileFormModal.tsx'
import RemoveMyBandDialog from '../components/myBands/RemoveMyBandDialog.tsx'
import LeaveBandDialog from '../components/myBands/LeaveBandDialog.tsx'
import { listMyBands } from '../api/myBands.ts'
import { listJoinRequests, withdrawJoinRequest } from '../api/bandDirectory.ts'
import type { JoinRequest } from '../api/bandDirectory.ts'
import { useAuth } from '../contexts/authContext.ts'
import { useCrossTenantNavigate } from '../hooks/useCrossTenantNavigate.ts'
import type { Id, MyBand } from '../types/entities.ts'
import type { MyBandsRow } from '../components/myBands/MyBandsTable.tsx'

type ModalState =
  | { kind: 'add' }
  | { kind: 'edit'; profileId: Id }
  | { kind: 'remove'; band: MyBand }
  | { kind: 'leave'; tenantId: Id; bandName: string }
  | null

/**
 * Every band this musician plays in, whether or not it uses gigbuddy.
 *
 * The two halves come from different places and behave differently: a gigbuddy
 * band is a membership, so it opens by switching workspace and is left rather
 * than removed. A global profile is a shared record the artist tags events
 * against, editable only by whoever created it.
 */
export default function MyBandsPage() {
  const { t } = useTranslation(['myBands', 'common'])
  const { user, refreshUser } = useAuth()
  const crossTenantNavigate = useCrossTenantNavigate()
  const [modal, setModal] = useState<ModalState>(null)

  const [reloadNonce, setReloadNonce] = useState(0)
  const reload = useCallback(() => setReloadNonce((n) => n + 1), [])
  const [state, setState] = useState<{ key: number; bands: MyBand[]; error: string | null } | null>(null)
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([])
  const loading = state?.key !== reloadNonce
  const error = state?.key === reloadNonce ? state.error : null

  useEffect(() => {
    let cancelled = false
    listMyBands()
      .then(({ items }) => { if (!cancelled) setState({ key: reloadNonce, bands: items, error: null }) })
      .catch((e) => {
        if (cancelled) return
        setState((prev) => ({
          key: reloadNonce,
          bands: prev?.bands ?? [],
          error: e instanceof Error ? e.message : String(e),
        }))
      })
    return () => { cancelled = true }
  }, [reloadNonce])

  // Bands the artist has asked to join and is still waiting on. Withdrawing is
  // only possible here, and outstanding requests are capped — so an artist
  // whose requests go unanswered would otherwise be stuck.
  useEffect(() => {
    let cancelled = false
    listJoinRequests()
      .then(({ items }) => { if (!cancelled) setJoinRequests(items) })
      .catch(() => { if (!cancelled) setJoinRequests([]) })
    return () => { cancelled = true }
  }, [reloadNonce])

  // gigbuddy bands come from the memberships already on the session, so the
  // page needs no second fetch for them.
  const rows: MyBandsRow[] = useMemo(() => {
    const memberships = (user?.memberships ?? [])
      .filter((m) => m.kind !== 'personal' && m.tenantId != null)
      .map((m): MyBandsRow => ({
        key: `tenant-${m.tenantId}`,
        name: m.tenantName ?? m.displayName ?? '',
        onGigbuddy: true,
        tenantId: m.tenantId as Id,
        membershipStatus: m.status ?? 'approved',
        avatarPath: m.tenantAvatarPath ?? null,
        accountingCountryCode: m.accountingCountryCode ?? null,
      }))

    const profiles = (state?.bands ?? []).map((band): MyBandsRow => ({
      key: `profile-${band.id}`,
      name: band.bandProfile.name,
      onGigbuddy: false,
      myBand: band,
    }))

    const membershipTenantIds = new Set(
      memberships.flatMap((row) => (row.onGigbuddy === true ? [String(row.tenantId)] : [])),
    )
    const requested = joinRequests
      // A pending membership already shows as a band row; the same band must
      // not appear twice.
      .filter((request) => !membershipTenantIds.has(String(request.tenantId)))
      .map((request): MyBandsRow => ({
        key: `request-${request.tenantId}`,
        name: request.displayName,
        onGigbuddy: 'requested',
        tenantId: request.tenantId,
      }))

    return [...memberships, ...requested, ...profiles].sort((a, b) => a.name.localeCompare(b.name))
  }, [user?.memberships, state?.bands, joinRequests])

  async function handleAdded() {
    setModal(null)
    reload()
  }

  async function handleJoined() {
    setModal(null)
    // A redeemed invite or an approved request changes the session's
    // memberships, which is where the gigbuddy half of this list comes from.
    await refreshUser()
    reload()
  }

  async function handleWithdraw(tenantId: Id) {
    await withdrawJoinRequest(tenantId)
    reload()
  }

  async function handleLeft() {
    setModal(null)
    await refreshUser()
  }

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
        <Typography variant="h5" sx={{ fontWeight: 600, flexGrow: 1 }}>
          {t($ => $.title)}
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setModal({ kind: 'add' })}>
          {t($ => $.addButton)}
        </Button>
      </Box>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        {t($ => $.subtitle)}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      )}

      {!loading && rows.length === 0 && (
        <Alert severity="info">{t($ => $.empty)}</Alert>
      )}

      {!loading && rows.length > 0 && (
        <MyBandsTable
          rows={rows}
          onOpen={(tenantId) => { void crossTenantNavigate(tenantId, '/') }}
          onEdit={(profileId) => setModal({ kind: 'edit', profileId })}
          onRemove={(band) => setModal({ kind: 'remove', band })}
          onLeave={(tenantId, bandName) => setModal({ kind: 'leave', tenantId, bandName })}
          onWithdraw={(tenantId) => { void handleWithdraw(tenantId) }}
        />
      )}

      {modal?.kind === 'add' && (
        <AddBandDialog
          onClose={() => setModal(null)}
          onAdded={handleAdded}
          onJoined={handleJoined}
        />
      )}
      {modal?.kind === 'edit' && (
        <BandProfileFormModal
          profileId={modal.profileId}
          onClose={() => { setModal(null); reload() }}
        />
      )}
      {modal?.kind === 'remove' && (
        <RemoveMyBandDialog
          band={modal.band}
          onClose={() => setModal(null)}
          onRemoved={() => { setModal(null); reload() }}
        />
      )}
      {modal?.kind === 'leave' && (
        <LeaveBandDialog
          tenantId={modal.tenantId}
          bandName={modal.bandName}
          onClose={() => setModal(null)}
          onLeft={handleLeft}
        />
      )}
    </>
  )
}
