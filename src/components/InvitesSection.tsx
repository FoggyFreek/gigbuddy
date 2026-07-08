import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActions from '@mui/material/CardActions'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import FormControl from '@mui/material/FormControl'
import IconButton from '@mui/material/IconButton'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Select from '@mui/material/Select'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteIcon from '@mui/icons-material/Delete'
import { listInvites, createInvite, revokeInvite } from '../api/invites.ts'
import { ASSIGNABLE_ROLES, ROLES } from '../auth/permissions.ts'
import { useCompactLayout } from '../hooks/useCompactLayout.ts'
import type { Id } from '../types/entities.ts'

interface Invite {
  id?: Id
  role?: string
  url?: string
  used_at?: string
  expires_at?: string
  used_by_name?: string
  created_at?: string
  created_by_name?: string
}

interface InvitesSectionProps {
  canIssueAdmin?: boolean
}

type InviteStatus = 'used' | 'expired' | 'active'

function inviteState(invite: Invite): { status: InviteStatus; color: 'default' | 'success' | 'warning' } {
  if (invite.used_at) return { status: 'used', color: 'default' }
  if (invite.expires_at && new Date(invite.expires_at) <= new Date()) {
    return { status: 'expired', color: 'warning' }
  }
  return { status: 'active', color: 'success' }
}

interface InviteActionsProps {
  invite: Invite
  isLive: boolean
  copiedId: Id | null
  onCopy: (invite: Invite) => void
  onRevoke: (id: Id) => void
}

function InviteActions({ invite, isLive, copiedId, onCopy, onRevoke }: Readonly<InviteActionsProps>) {
  const { t } = useTranslation('settings')
  return (
    <>
      <Tooltip title={copiedId === invite.id ? t($ => $.invites.copiedTooltip) : t($ => $.invites.copyTooltip)}>
        <span>
          <IconButton
            size="small"
            onClick={() => onCopy(invite)}
            aria-label={t($ => $.invites.aria.copyUrl)}
            disabled={!isLive}
          >
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={isLive ? t($ => $.invites.revokeTooltip) : t($ => $.invites.alreadyInactiveTooltip)}>
        <span>
          <IconButton
            size="small"
            color="error"
            onClick={() => onRevoke(invite.id!)}
            aria-label={t($ => $.invites.aria.revoke)}
            disabled={!isLive}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    </>
  )
}

interface InviteDetailRowProps {
  label: string
  value: string
}

function InviteDetailRow({ label, value }: Readonly<InviteDetailRowProps>) {
  return (
    <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between' }}>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {label}
      </Typography>
      <Typography variant="caption" sx={{ textAlign: 'right' }}>
        {value}
      </Typography>
    </Stack>
  )
}

interface InviteCardProps {
  invite: Invite
  copiedId: Id | null
  onCopy: (invite: Invite) => void
  onRevoke: (id: Id) => void
}

function InviteCard({ invite, copiedId, onCopy, onRevoke }: Readonly<InviteCardProps>) {
  const { t } = useTranslation('settings')
  const state = inviteState(invite)
  const isLive = state.status === 'active'
  const created = invite.created_at ? new Date(invite.created_at).toLocaleDateString() : '—'
  const createdBy = invite.created_by_name ? ` · ${invite.created_by_name}` : ''
  const expires = invite.expires_at ? new Date(invite.expires_at).toLocaleDateString() : '—'
  const usedBy =
    invite.used_by_name && invite.used_at
      ? `${invite.used_by_name} · ${new Date(invite.used_at).toLocaleDateString()}`
      : null
  return (
    <Card variant="outlined">
      <CardContent sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, flexGrow: 1, textTransform: 'capitalize' }}>
            {invite.role}
          </Typography>
          <Chip size="small" label={t($ => $.invites.status[state.status])} color={state.color} />
        </Stack>
        <Stack spacing={0.5}>
          <InviteDetailRow label={t($ => $.invites.columns.created)} value={`${created}${createdBy}`} />
          <InviteDetailRow label={t($ => $.invites.columns.expires)} value={expires} />
          {usedBy && <InviteDetailRow label={t($ => $.invites.columns.usedBy)} value={usedBy} />}
        </Stack>
      </CardContent>
      <Divider />
      <CardActions sx={{ justifyContent: 'flex-end', px: 1, py: 0.5, gap: 0.5 }}>
        <InviteActions
          invite={invite}
          isLive={isLive}
          copiedId={copiedId}
          onCopy={onCopy}
          onRevoke={onRevoke}
        />
      </CardActions>
    </Card>
  )
}

export default function InvitesSection({ canIssueAdmin = false }: Readonly<InvitesSectionProps>) {
  const { t } = useTranslation(['settings', 'common'])
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [role, setRole] = useState('contributor')
  const [expiresInDays, setExpiresInDays] = useState('14')
  const [submitting, setSubmitting] = useState(false)
  const [copiedId, setCopiedId] = useState<Id | null>(null)
  const isCompact = useCompactLayout()

  useEffect(() => {
    listInvites()
      .then((rows) => setInvites(rows as Invite[]))
      .catch((err: Error) => setError(err.message || t($ => $.invites.errors.loadFailed)))
      .finally(() => setLoading(false))
  }, [t])

  const handleCreate = async () => {
    setError('')
    setSubmitting(true)
    try {
      const payload: Record<string, unknown> = { role }
      const days = expiresInDays.trim()
      if (days !== '') payload.expiresInDays = Number(days)
      const created = await createInvite(payload as Parameters<typeof createInvite>[0])
      setInvites((prev) => [created as Invite, ...prev])
      setDialogOpen(false)
      setRole('contributor')
      setExpiresInDays('14')
    } catch (err) {
      setError((err as Error).message || t($ => $.invites.errors.createFailed))
    } finally {
      setSubmitting(false)
    }
  }

  const handleRevoke = async (id: Id) => {
    setError('')
    try {
      await revokeInvite(id)
      const refreshed = await listInvites()
      setInvites(refreshed as Invite[])
    } catch (err) {
      setError((err as Error).message || t($ => $.invites.errors.revokeFailed))
    }
  }

  const handleCopy = async (invite: Invite) => {
    try {
      await navigator.clipboard.writeText(invite.url ?? '')
      setCopiedId(invite.id ?? null)
      setTimeout(() => setCopiedId((id) => (id === invite.id ? null : id)), 1500)
    } catch {
      setError(t($ => $.invites.errors.copyFailed))
    }
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setDialogOpen(true)}
          fullWidth={isCompact}
        >
          {t($ => $.invites.newInvite)}
        </Button>
      </Stack>
      {error && (
        <Typography color="error" variant="body2">
          {error}
        </Typography>
      )}

      {isCompact ? (
        <Stack spacing={1.5}>
          {invites.length === 0 ? (
            <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', py: 3 }}>
              {t($ => $.invites.noInvitesYet)}
            </Typography>
          ) : (
            invites.map((inv) => (
              <InviteCard
                key={String(inv.id)}
                invite={inv}
                copiedId={copiedId}
                onCopy={handleCopy}
                onRevoke={handleRevoke}
              />
            ))
          )}
          <Typography variant="body2" sx={{ color: 'text.secondary', m: 2 }}>
            {t($ => $.invites.singleUseHint)}
          </Typography>
        </Stack>
      ) : (
        <Paper variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t($ => $.invites.role)}</TableCell>
                <TableCell>{t($ => $.invites.columns.state)}</TableCell>
                <TableCell>{t($ => $.invites.columns.created)}</TableCell>
                <TableCell>{t($ => $.invites.columns.expires)}</TableCell>
                <TableCell>{t($ => $.invites.columns.usedBy)}</TableCell>
                <TableCell align="right">{t($ => $.invites.columns.actions)}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {invites.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} align="center">
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      {t($ => $.invites.noInvitesYet)}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {invites.map((inv) => {
                const state = inviteState(inv)
                const isLive = state.status === 'active'
                return (
                  <TableRow key={String(inv.id)}>
                    <TableCell>{inv.role}</TableCell>
                    <TableCell>
                      <Chip size="small" label={t($ => $.invites.status[state.status])} color={state.color} />
                    </TableCell>
                    <TableCell>
                      {inv.created_at ? new Date(inv.created_at).toLocaleDateString() : '—'}
                      {inv.created_by_name ? ` · ${inv.created_by_name}` : ''}
                    </TableCell>
                    <TableCell>
                      {inv.expires_at
                        ? new Date(inv.expires_at).toLocaleDateString()
                        : '—'}
                    </TableCell>
                    <TableCell>
                      {inv.used_by_name && inv.used_at
                        ? `${inv.used_by_name} · ${new Date(inv.used_at).toLocaleDateString()}`
                        : '—'}
                    </TableCell>
                    <TableCell align="right">
                      <Stack
                        direction="row"
                        spacing={0.5}
                        sx={{ justifyContent: 'flex-end' }}
                      >
                        <InviteActions
                          invite={inv}
                          isLive={isLive}
                          copiedId={copiedId}
                          onCopy={handleCopy}
                          onRevoke={handleRevoke}
                        />
                      </Stack>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <Typography variant="body2" sx={{ color: 'text.secondary', flexGrow: 1, m: 2 }}>
            {t($ => $.invites.singleUseHint)}
          </Typography>
        </Paper>
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{t($ => $.invites.newInvite)}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth size="small">
              <InputLabel id="invite-role-label">{t($ => $.invites.role)}</InputLabel>
              <Select
                labelId="invite-role-label"
                label={t($ => $.invites.role)}
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                {[...ASSIGNABLE_ROLES].map((r) => (
                  <MenuItem key={r} value={r}>{r}</MenuItem>
                ))}
                <MenuItem value={ROLES.TENANT_ADMIN} disabled={!canIssueAdmin}>
                  {ROLES.TENANT_ADMIN}{canIssueAdmin ? '' : t($ => $.invites.superAdminOnly)}
                </MenuItem>
              </Select>
            </FormControl>
            <TextField
              size="small"
              label={t($ => $.invites.expiresInDays)}
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              helperText={t($ => $.invites.expiresHelper)}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{t($ => $.common.actions.cancel)}</Button>
          <Button variant="contained" onClick={handleCreate} disabled={submitting}>
            {t($ => $.invites.create)}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
