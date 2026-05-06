import { useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
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
import { listInvites, createInvite, revokeInvite } from '../api/invites.js'

function inviteState(invite) {
  if (invite.used_at) return { label: 'used', color: 'default' }
  if (invite.expires_at && new Date(invite.expires_at) <= new Date()) {
    return { label: 'expired', color: 'warning' }
  }
  return { label: 'active', color: 'success' }
}

export default function InvitesSection({ canIssueAdmin = false }) {
  const [invites, setInvites] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [role, setRole] = useState('member')
  const [expiresInDays, setExpiresInDays] = useState('14')
  const [submitting, setSubmitting] = useState(false)
  const [copiedId, setCopiedId] = useState(null)

  useEffect(() => {
    listInvites()
      .then((rows) => setInvites(rows))
      .catch((err) => setError(err.message || 'Failed to load invites'))
      .finally(() => setLoading(false))
  }, [])

  const handleCreate = async () => {
    setError('')
    setSubmitting(true)
    try {
      const payload = { role }
      const days = expiresInDays.trim()
      if (days !== '') payload.expiresInDays = Number(days)
      const created = await createInvite(payload)
      setInvites((prev) => [created, ...prev])
      setDialogOpen(false)
      setRole('member')
      setExpiresInDays('14')
    } catch (err) {
      setError(err.message || 'Create failed')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRevoke = async (id) => {
    setError('')
    try {
      await revokeInvite(id)
      const refreshed = await listInvites()
      setInvites(refreshed)
    } catch (err) {
      setError(err.message || 'Revoke failed')
    }
  }

  const handleCopy = async (invite) => {
    try {
      await navigator.clipboard.writeText(invite.url)
      setCopiedId(invite.id)
      setTimeout(() => setCopiedId((id) => (id === invite.id ? null : id)), 1500)
    } catch {
      setError('Could not copy to clipboard')
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
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
          Invite codes are single-use. Send the URL to the person you want to invite.
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setDialogOpen(true)}
        >
          New invite
        </Button>
      </Stack>
      {error && (
        <Typography color="error" variant="body2">
          {error}
        </Typography>
      )}

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Role</TableCell>
              <TableCell>State</TableCell>
              <TableCell>Created</TableCell>
              <TableCell>Expires</TableCell>
              <TableCell>Used by</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {invites.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <Typography variant="body2" color="text.secondary">
                    No invites yet.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {invites.map((inv) => {
              const state = inviteState(inv)
              const isLive = state.label === 'active'
              return (
                <TableRow key={inv.id}>
                  <TableCell>{inv.role}</TableCell>
                  <TableCell>
                    <Chip size="small" label={state.label} color={state.color} />
                  </TableCell>
                  <TableCell>
                    {new Date(inv.created_at).toLocaleDateString()}
                    {inv.created_by_name ? ` · ${inv.created_by_name}` : ''}
                  </TableCell>
                  <TableCell>
                    {inv.expires_at
                      ? new Date(inv.expires_at).toLocaleDateString()
                      : '—'}
                  </TableCell>
                  <TableCell>
                    {inv.used_by_name
                      ? `${inv.used_by_name} · ${new Date(inv.used_at).toLocaleDateString()}`
                      : '—'}
                  </TableCell>
                  <TableCell align="right">
                    <Stack
                      direction="row"
                      spacing={0.5}
                      sx={{ justifyContent: 'flex-end' }}
                    >
                      <Tooltip
                        title={
                          copiedId === inv.id ? 'Copied!' : 'Copy invite URL'
                        }
                      >
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => handleCopy(inv)}
                            aria-label="copy invite URL"
                            disabled={!isLive}
                          >
                            <ContentCopyIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip
                        title={isLive ? 'Revoke invite' : 'Already inactive'}
                      >
                        <span>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleRevoke(inv.id)}
                            aria-label="revoke invite"
                            disabled={!isLive}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Paper>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>New invite</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth size="small">
              <InputLabel id="invite-role-label">Role</InputLabel>
              <Select
                labelId="invite-role-label"
                label="Role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <MenuItem value="member">member</MenuItem>
                <MenuItem value="tenant_admin" disabled={!canIssueAdmin}>
                  tenant_admin {canIssueAdmin ? '' : '(super admin only)'}
                </MenuItem>
              </Select>
            </FormControl>
            <TextField
              size="small"
              label="Expires in (days)"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              helperText="Leave blank for no expiry. Max 365."
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={submitting}>
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
