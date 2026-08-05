import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useAuth } from '../../contexts/authContext.ts'
import { useCompactLayout } from '../../hooks/useCompactLayout.ts'
import { redeemInvite } from '../../api/invites.ts'
import { parseInviteCode } from '../../utils/inviteCode.ts'
import BandDirectorySearch from './BandDirectorySearch.tsx'

type MembershipStatus = 'pending' | 'approved'

const STATUS_COLOR: Record<MembershipStatus, 'default' | 'success'> = {
  pending: 'default',
  approved: 'success',
}

// The personal counterpart of a band's "Members and invites": the bands this
// musician plays in, and the way into another one. Redemption is user-level
// (loadUser only), so it works whatever the active tenant is — no need to
// switch out of the workspace first.
export default function BandsSection() {
  const { t } = useTranslation('settings')
  const compact = useCompactLayout()
  const { user, refreshUser } = useAuth()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [joined, setJoined] = useState<string | null>(null)

  const bands = (user?.memberships ?? []).filter((m) => m.kind !== 'personal')

  async function handleJoin() {
    const parsed = parseInviteCode(code)
    if (!parsed) {
      setError(t($ => $.bands.errors.noCode))
      return
    }
    setBusy(true)
    setError(null)
    setJoined(null)
    try {
      await redeemInvite(parsed)
      setCode('')
      // The band's admins approve; until then the row shows as pending.
      setJoined(t($ => $.bands.joinPending))
      await refreshUser()
    } catch (err) {
      setError((err instanceof Error ? err.message : null) ?? t($ => $.bands.errors.joinFailed))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: compact ? 1.5 : 3 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        {t($ => $.bands.title)}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
        {t($ => $.bands.intro)}
      </Typography>

      {bands.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 2 }}>
          {t($ => $.bands.empty)}
        </Typography>
      ) : (
        <List dense>
          {bands.map((m) => (
            <ListItem key={String(m.tenantId)} disableGutters
              secondaryAction={
                <Chip
                  size="small"
                  label={t($ => $.members.status[(m.status ?? 'pending') as MembershipStatus])}
                  color={STATUS_COLOR[(m.status ?? 'pending') as MembershipStatus]}
                />
              }
            >
              <ListItemText
                primary={m.displayName ?? m.tenantName}
                secondary={m.status === 'pending' ? t($ => $.bands.awaitingApproval) : null}
              />
            </ListItem>
          ))}
        </List>
      )}

      <Box sx={{ mt: 3 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          {t($ => $.bands.joinTitle)}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, mb: 1.5 }}>
          {t($ => $.bands.joinHelp)}
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}
        {joined && <Alert severity="success" sx={{ mb: 1.5 }}>{joined}</Alert>}

        <Stack direction={compact ? 'column' : 'row'} spacing={1} sx={{ alignItems: 'flex-start' }}>
          <TextField
            label={t($ => $.bands.codeLabel)}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={busy}
            fullWidth
            size="small"
          />
          <Button
            variant="contained"
            onClick={() => { void handleJoin() }}
            disabled={busy || code.trim() === ''}
          >
            {t($ => $.bands.join)}
          </Button>
        </Stack>
      </Box>

      <BandDirectorySearch />
    </Paper>
  )
}
