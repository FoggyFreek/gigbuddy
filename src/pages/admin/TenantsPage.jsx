import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Autocomplete from '@mui/material/Autocomplete'
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
import ArchiveIcon from '@mui/icons-material/Archive'
import LoginIcon from '@mui/icons-material/Login'
import PersonAddIcon from '@mui/icons-material/PersonAdd'
import UnarchiveIcon from '@mui/icons-material/Unarchive'
import {
  listTenants,
  createTenant,
  archiveTenant,
  unarchiveTenant,
  grantMembership,
} from '../../api/tenants.js'
import { listAllUsers } from '../../api/adminUsers.js'
import { useAuth } from '../../contexts/authContext.js'

export default function TenantsPage() {
  const navigate = useNavigate()
  const { user, switchTenant } = useAuth()
  const [tenants, setTenants] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [slug, setSlug] = useState('')
  const [bandName, setBandName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const [memberDialog, setMemberDialog] = useState({ open: false, tenant: null })
  const [memberUser, setMemberUser] = useState(null)
  const [memberRole, setMemberRole] = useState('member')
  const [memberSubmitting, setMemberSubmitting] = useState(false)
  const [memberError, setMemberError] = useState('')

  const refresh = () => {
    setLoading(true)
    Promise.all([listTenants(), listAllUsers()])
      .then(([t, u]) => {
        setTenants(t)
        setUsers(u)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refresh()
  }, [])

  const handleCreate = async () => {
    setSubmitting(true)
    setError('')
    try {
      await createTenant({ slug: slug.trim(), band_name: bandName.trim() })
      setCreateOpen(false)
      setSlug('')
      setBandName('')
      refresh()
    } catch (err) {
      setError(err.message || 'Create failed')
    } finally {
      setSubmitting(false)
    }
  }

  const handleArchive = async (t) => {
    if (t.archived_at) {
      await unarchiveTenant(t.id)
    } else {
      await archiveTenant(t.id)
    }
    refresh()
  }

  const handleSwitch = async (t) => {
    try {
      await switchTenant(t.id)
      navigate('/')
    } catch (err) {
      setError(err.message || 'Switch failed')
    }
  }

  const openMemberDialog = (t) => {
    setMemberUser(null)
    setMemberRole('member')
    setMemberError('')
    setMemberDialog({ open: true, tenant: t })
  }

  const handleAddMember = async () => {
    if (!memberUser || !memberDialog.tenant) return
    setMemberSubmitting(true)
    setMemberError('')
    try {
      await grantMembership(memberDialog.tenant.id, {
        userId: memberUser.id,
        role: memberRole,
      })
      setMemberDialog({ open: false, tenant: null })
      refresh()
    } catch (err) {
      setMemberError(err.message || 'Add failed')
    } finally {
      setMemberSubmitting(false)
    }
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Stack direction="row" sx={{ alignItems: 'center' }}>
        <Typography variant="h5" fontWeight={700} sx={{ flexGrow: 1 }}>
          Tenants
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setCreateOpen(true)}
        >
          New tenant
        </Button>
      </Stack>
      {error && (
        <Typography color="error" variant="body2">
          {error}
        </Typography>
      )}

      {/* Desktop table — hidden below 600 px */}
      <Paper variant="outlined" sx={{ display: { xs: 'none', sm: 'block' } }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>ID</TableCell>
              <TableCell>Slug</TableCell>
              <TableCell>Band name</TableCell>
              <TableCell align="right">Members</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {tenants.map((t) => {
              const isActive = user?.activeTenantId === t.id
              const archived = !!t.archived_at
              return (
                <TableRow key={t.id} selected={isActive}>
                  <TableCell>{t.id}</TableCell>
                  <TableCell>{t.slug}</TableCell>
                  <TableCell>{t.band_name}</TableCell>
                  <TableCell align="right">{t.member_count}</TableCell>
                  <TableCell>
                    {archived ? (
                      <Chip size="small" label="archived" color="warning" />
                    ) : (
                      <Chip size="small" label="active" color="success" />
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Stack
                      direction="row"
                      spacing={0.5}
                      sx={{ justifyContent: 'flex-end' }}
                    >
                      <Tooltip
                        title={
                          archived
                            ? 'Unarchive to switch in'
                            : isActive
                            ? 'Already active'
                            : 'Switch to this tenant'
                        }
                      >
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => handleSwitch(t)}
                            disabled={archived || isActive}
                            aria-label="switch to tenant"
                          >
                            <LoginIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title={archived ? 'Unarchive to add members' : 'Add member'}>
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => openMemberDialog(t)}
                            disabled={archived}
                            aria-label="add member"
                          >
                            <PersonAddIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title={archived ? 'Unarchive' : 'Archive'}>
                        <IconButton size="small" onClick={() => handleArchive(t)}>
                          {archived ? <UnarchiveIcon fontSize="small" /> : <ArchiveIcon fontSize="small" />}
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Paper>

      {/* Mobile cards — visible below 600 px */}
      <Stack spacing={1.5} sx={{ display: { xs: 'flex', sm: 'none' } }}>
        {tenants.map((t) => {
          const isActive = user?.activeTenantId === t.id
          const archived = !!t.archived_at
          return (
            <Card
              key={t.id}
              variant="outlined"
              sx={isActive ? { borderColor: 'primary.main' } : {}}
            >
              <CardContent sx={{ pb: 1 }}>
                <Stack
                  direction="row"
                  sx={{
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    mb: 0.5,
                  }}
                >
                  <Typography variant="subtitle1" fontWeight={700} sx={{ flexGrow: 1, mr: 1 }}>
                    {t.band_name}
                  </Typography>
                  {archived ? (
                    <Chip size="small" label="archived" color="warning" />
                  ) : (
                    <Chip size="small" label="active" color="success" />
                  )}
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  ID: {t.id} · Slug: {t.slug}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Members: {t.member_count}
                </Typography>
              </CardContent>
              <Divider />
              <CardActions sx={{ justifyContent: 'flex-end', px: 1, py: 0.5 }}>
                <Tooltip
                  title={
                    archived
                      ? 'Unarchive to switch in'
                      : isActive
                      ? 'Already active'
                      : 'Switch to this tenant'
                  }
                >
                  <span>
                    <IconButton
                      size="small"
                      onClick={() => handleSwitch(t)}
                      disabled={archived || isActive}
                      aria-label="switch to tenant"
                    >
                      <LoginIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title={archived ? 'Unarchive to add members' : 'Add member'}>
                  <span>
                    <IconButton
                      size="small"
                      onClick={() => openMemberDialog(t)}
                      disabled={archived}
                      aria-label="add member"
                    >
                      <PersonAddIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title={archived ? 'Unarchive' : 'Archive'}>
                  <IconButton size="small" onClick={() => handleArchive(t)}>
                    {archived ? <UnarchiveIcon fontSize="small" /> : <ArchiveIcon fontSize="small" />}
                  </IconButton>
                </Tooltip>
              </CardActions>
            </Card>
          )
        })}
      </Stack>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>New tenant</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              helperText="lowercase letters, digits, hyphens"
              fullWidth
            />
            <TextField
              label="Band name"
              value={bandName}
              onChange={(e) => setBandName(e.target.value)}
              fullWidth
            />
            <Typography variant="caption" color="text.secondary">
              You will be added as the initial tenant_admin so the new tenant
              is immediately usable. Reassign or add members from the Tenants
              list afterwards.
            </Typography>
            {error && (
              <Typography color="error" variant="body2">
                {error}
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={submitting || !slug.trim() || !bandName.trim()}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={memberDialog.open}
        onClose={() => setMemberDialog({ open: false, tenant: null })}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>
          Add member to {memberDialog.tenant?.band_name || ''}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Autocomplete
              options={users}
              value={memberUser}
              onChange={(_, v) => setMemberUser(v)}
              getOptionLabel={(u) => `${u.name || u.email} (${u.email})`}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              renderInput={(params) => <TextField {...params} label="User" />}
            />
            <FormControl fullWidth>
              <InputLabel id="grant-role-label">Role</InputLabel>
              <Select
                labelId="grant-role-label"
                label="Role"
                value={memberRole}
                onChange={(e) => setMemberRole(e.target.value)}
              >
                <MenuItem value="member">member</MenuItem>
                <MenuItem value="tenant_admin">tenant_admin</MenuItem>
              </Select>
            </FormControl>
            <Typography variant="caption" color="text.secondary">
              Grants an approved membership directly. The user does not need
              to redeem an invite.
            </Typography>
            {memberError && (
              <Typography color="error" variant="body2">
                {memberError}
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMemberDialog({ open: false, tenant: null })}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleAddMember}
            disabled={memberSubmitting || !memberUser}
          >
            Add
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
