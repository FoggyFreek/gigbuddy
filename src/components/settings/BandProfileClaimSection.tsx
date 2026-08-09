import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import useRemoteSearch from '../../hooks/useRemoteSearch.ts'
import { searchBandProfiles } from '../../api/bandProfiles.ts'
import { getOwnClaim, requestClaim, withdrawClaim } from '../../api/bandProfileClaims.ts'
import type { BandProfile, BandProfileClaim } from '../../types/entities.ts'

const STATUS_COLOR: Record<BandProfileClaim['status'], 'warning' | 'success' | 'error'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
}

/**
 * Claiming the global band profile that musicians have been tagging their
 * events against, so this band takes it over.
 *
 * Verification happens offline — a super admin checks that the claimant really
 * is the band — so this is a request, never a self-service switch. A band sees
 * only its own claim; the queue is the super admin's.
 */
export default function BandProfileClaimSection() {
  const { t } = useTranslation(['settings', 'common'])
  const [selected, setSelected] = useState<BandProfile | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The fetched claim is tagged with the reload it answered, so `loading` is
  // derived rather than a flag flipped from inside the effect.
  const [reloadNonce, setReloadNonce] = useState(0)
  const reload = useCallback(() => setReloadNonce((n) => n + 1), [])
  const [state, setState] = useState<{ key: number; claim: BandProfileClaim | null } | null>(null)
  const claim = state?.claim ?? null
  const loading = state?.key !== reloadNonce

  useEffect(() => {
    let cancelled = false
    getOwnClaim()
      .then((res) => { if (!cancelled) setState({ key: reloadNonce, claim: res.claim }) })
      .catch(() => { if (!cancelled) setState({ key: reloadNonce, claim: null }) })
    return () => { cancelled = true }
  }, [reloadNonce])

  const search = useRemoteSearch<BandProfile>({
    // Only unclaimed profiles can be claimed, so a claimed one is noise here.
    search: async (q) => (await searchBandProfiles({ q })).items.filter((p) => !p.claimed),
    enabled: claim === null || claim.status === 'rejected',
  })

  async function handleClaim() {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      await requestClaim(selected.id, message.trim() || undefined)
      setSelected(null)
      setMessage('')
      reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleWithdraw() {
    if (!claim) return
    setBusy(true)
    setError(null)
    try {
      await withdrawClaim(claim.id)
      reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const settled = claim !== null && claim.status !== 'pending'
  const canClaim = claim === null || claim.status === 'rejected'

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h6" sx={{ mb: 0.5 }}>{t($ => $.bandProfileClaim.title)}</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        {t($ => $.bandProfileClaim.description)}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={24} /></Box>
      )}

      {!loading && claim !== null && (
        <Stack spacing={1} sx={{ mb: canClaim ? 3 : 0 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            {/* The name is a snapshot, so it still reads after the profile is gone. */}
            <Typography sx={{ fontWeight: 600 }}>{claim.bandProfileName}</Typography>
            <Chip size="small" color={STATUS_COLOR[claim.status]} label={t($ => $.bandProfileClaim.status[claim.status])} />
          </Stack>
          {claim.status === 'pending' && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {t($ => $.bandProfileClaim.pendingHelp)}
            </Typography>
          )}
          {claim.status === 'rejected' && claim.decisionReason && (
            <Alert severity="warning">{claim.decisionReason}</Alert>
          )}
          {claim.status === 'approved' && (
            <Alert severity="success">{t($ => $.bandProfileClaim.approvedHelp)}</Alert>
          )}
          {claim.status === 'pending' && (
            <Box>
              <Button size="small" color="error" disabled={busy} onClick={handleWithdraw}>
                {t($ => $.bandProfileClaim.withdraw)}
              </Button>
            </Box>
          )}
        </Stack>
      )}

      {!loading && canClaim && (
        <Stack spacing={2}>
          {settled && <Typography variant="body2">{t($ => $.bandProfileClaim.tryAgain)}</Typography>}
          <TextField
            label={t($ => $.bandProfileClaim.searchLabel)}
            value={search.inputValue}
            onChange={(e) => {
              search.onInputChange(null, e.target.value, 'input')
              setSelected(null)
            }}
            helperText={search.tooShort ? t($ => $.bandProfileClaim.searchHint) : undefined}
            fullWidth
          />

          {!search.tooShort && !search.loading && search.options.length === 0 && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {t($ => $.bandProfileClaim.noResults)}
            </Typography>
          )}

          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            {search.options.map((profile) => (
              <Chip
                key={String(profile.id)}
                label={`${profile.name} (${profile.countryCode.toUpperCase()})`}
                clickable
                color={selected?.id === profile.id ? 'primary' : 'default'}
                onClick={() => setSelected(profile)}
              />
            ))}
          </Stack>

          {selected && (
            <>
              <TextField
                label={t($ => $.bandProfileClaim.messageLabel)}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                helperText={t($ => $.bandProfileClaim.messageHint)}
                multiline
                minRows={2}
                fullWidth
              />
              <Box>
                <Button variant="contained" disabled={busy} onClick={handleClaim}>
                  {t($ => $.bandProfileClaim.submit)}
                </Button>
              </Box>
            </>
          )}
        </Stack>
      )}
    </Paper>
  )
}
