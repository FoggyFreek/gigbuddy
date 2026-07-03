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
import RefreshIcon from '@mui/icons-material/Refresh'
import UnarchiveIcon from '@mui/icons-material/Unarchive'
import DeleteForeverIcon from '@mui/icons-material/DeleteForever'
import {
  listTenants,
  createTenant,
  archiveTenant,
  unarchiveTenant,
  grantMembership,
  deleteTenant,
} from '../../api/tenants.ts'
import { listAllUsers } from '../../api/adminUsers.ts'
import { getAllStorageStats, refreshAllStorageStats } from '../../api/statistics.ts'
import { formatBytes } from '../../utils/formatBytes.ts'
import { useAuth } from '../../contexts/authContext.ts'
import type { Tenant, Id } from '../../types/entities.ts'

interface TenantRow extends Tenant {
  slug?: string
  archived_at?: string | null
  member_count?: number
}

interface StorageStats {
  tenant_id?: Id
  storage_bytes?: number
  object_count?: number
}

interface AdminUser {
  id?: Id
  name?: string
  email?: string
}

export default function TenantsPage() {
  const navigate = useNavigate()
  const { user, switchTenant } = useAuth()
  const [tenants, setTenants] = useState<TenantRow[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [storageByTenant, setStorageByTenant] = useState<Record<string, StorageStats>>({})
  const [recomputing, setRecomputing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [slug, setSlug] = useState('')
  const [bandName, setBandName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const [memberDialog, setMemberDialog] = useState<{ open: boolean; tenant: TenantRow | null }>({ open: false, tenant: null })
  const [memberUser, setMemberUser] = useState<AdminUser | null>(null)
  const [memberRole, setMemberRole] = useState('member')
  const [memberSubmitting, setMemberSubmitting] = useState(false)
  const [memberError, setMemberError] = useState('')
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; tenant: TenantRow | null }>({ open: false, tenant: null })
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const refresh = () => {
    setLoading(true)
    Promise.all([listTenants(), listAllUsers(), getAllStorageStats()])
      .then(([t, u, stats]) => {
        setTenants(t as TenantRow[])
        setUsers(u as AdminUser[])
        setStorageByTenant(Object.fromEntries((stats as StorageStats[]).map((s) => [String(s.tenant_id), s])))
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refresh()
   
  }, [])

  const handleRecomputeStorage = async () => {
    setRecomputing(true)
    try {
      const stats = await refreshAllStorageStats()
      setStorageByTenant(Object.fromEntries((stats as StorageStats[]).map((s) => [String(s.tenant_id), s])))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recompute failed')
    } finally {
      setRecomputing(false)
    }
  }

  const handleCreate = async () => {
    setSubmitting(true)
    setError('')
    try {
      await createTenant({ slug: slug.trim(), band_name: bandName.trim() } as Partial<Tenant>)
      setCreateOpen(false)
      setSlug('')
      setBandName('')
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setSubmitting(false)
    }
  }

  const handleArchive = async (t: TenantRow) => {
    if (t.archived_at) {
      await unarchiveTenant(t.id as Id)
    } else {
      await archiveTenant(t.id as Id)
    }
    refresh()
  }

  const handleSwitch = async (t: TenantRow) => {
    try {
      await switchTenant(t.id as Id)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Switch failed')
    }
  }

  const openMemberDialog = (t: TenantRow) => {
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
      await grantMembership(memberDialog.tenant.id as Id, {
        user_id: memberUser.id,
        role: memberRole,
      })
      setMemberDialog({ open: false, tenant: null })
      refresh()
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : 'Add failed')
    } finally {
      setMemberSubmitting(false)
    }
  }

  const openDeleteDialog = (tenant: TenantRow) => {
    if (!tenant.archived_at) return
    setDeleteConfirmation('')
    setDeleteError('')
    setDeleteDialog({ open: true, tenant })
  }

  const closeDeleteDialog = () => {
    if (deleteSubmitting) return
    setDeleteDialog({ open: false, tenant: null })
  }

  const handleDelete = async () => {
    const tenant = deleteDialog.tenant
    if (!tenant?.id || deleteConfirmation !== tenant.slug) return
    setDeleteSubmitting(true)
    setDeleteError('')
    try {
      await deleteTenant(tenant.id, deleteConfirmation)
      setDeleteDialog({ open: false, tenant: null })
      setDeleteConfirmation('')
      refresh()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeleteSubmitting(false)
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
        <Typography variant="h5" sx={{ fontWeight: 700, flexGrow: 1 }}>
          Tenants
        </Typography>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={handleRecomputeStorage}
          disabled={recomputing}
          sx={{ mr: 1 }}
        >
          {recomputing ? 'Recomputing…' : 'Recompute storage'}
        </Button>
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
              <TableCell align="right">Storage</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {tenants.map((t) => {
              const isActive = user?.activeTenantId === t.id
              const archived = !!t.archived_at
              const stats = storageByTenant[String(t.id)]
              let switchTooltip: string
              if (archived) {
                switchTooltip = 'Unarchive to switch in'
              } else if (isActive) {
                switchTooltip = 'Already active'
              } else {
                switchTooltip = 'Switch to this tenant'
              }
              return (
                <TableRow key={String(t.id)} selected={isActive}>
                  <TableCell>{t.id}</TableCell>
                  <TableCell>{t.slug}</TableCell>
                  <TableCell>{t.band_name}</TableCell>
                  <TableCell align="right">{t.member_count}</TableCell>
                  <TableCell align="right">
                    <Tooltip title={stats ? `${stats.object_count} files` : ''}>
                      <span>{formatBytes(stats?.storage_bytes)}</span>
                    </Tooltip>
                  </TableCell>
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
                        title={switchTooltip}
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
                      <Tooltip title={archived ? 'Permanently delete' : 'Archive before deleting'}>
                        <span>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => openDeleteDialog(t)}
                            disabled={!archived}
                            aria-label={`permanently delete ${t.band_name}`}
                          >
                            <DeleteForeverIcon fontSize="small" />
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

      {/* Mobile cards — visible below 600 px */}
      <Stack spacing={1.5} sx={{ display: { xs: 'flex', sm: 'none' } }}>
        {tenants.map((t) => {
          const isActive = user?.activeTenantId === t.id
          const archived = !!t.archived_at
          const stats = storageByTenant[String(t.id)]
          let switchTooltip: string
          if (archived) {
            switchTooltip = 'Unarchive to switch in'
          } else if (isActive) {
            switchTooltip = 'Already active'
          } else {
            switchTooltip = 'Switch to this tenant'
          }
          return (
            <Card
              key={String(t.id)}
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
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, flexGrow: 1, mr: 1 }}>
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
                <Typography variant="body2" color="text.secondary">
                  Storage: {formatBytes(stats?.storage_bytes)}
                  {stats ? ` · ${stats.object_count} files` : ''}
                </Typography>
              </CardContent>
              <Divider />
              <CardActions sx={{ justifyContent: 'flex-end', px: 1, py: 0.5 }}>
                <Tooltip
                  title={switchTooltip}
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
                <Tooltip title={archived ? 'Permanently delete' : 'Archive before deleting'}>
                  <span>
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => openDeleteDialog(t)}
                      disabled={!archived}
                      aria-label={`permanently delete ${t.band_name}`}
                    >
                      <DeleteForeverIcon fontSize="small" />
                    </IconButton>
                  </span>
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

      <Dialog
        open={deleteDialog.open}
        onClose={closeDeleteDialog}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Delete {deleteDialog.tenant?.band_name || 'tenant'} permanently?</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2">
              This permanently deletes all PostgreSQL and RustFS data for this tenant. This action cannot be undone.
            </Typography>
            <Typography variant="body2">
              Type <strong>{deleteDialog.tenant?.slug}</strong> to confirm.
            </Typography>
            <TextField
              label={`Type ${deleteDialog.tenant?.slug || ''} to confirm`}
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              disabled={deleteSubmitting}
              autoComplete="off"
              fullWidth
            />
            {deleteError && (
              <Typography color="error" variant="body2">{deleteError}</Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDeleteDialog} disabled={deleteSubmitting}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDelete}
            disabled={deleteSubmitting || deleteConfirmation !== deleteDialog.tenant?.slug}
          >
            {deleteSubmitting ? 'Deleting…' : 'Delete permanently'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
