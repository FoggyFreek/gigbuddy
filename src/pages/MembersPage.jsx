import { useEffect, useState } from 'react'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActions from '@mui/material/CardActions'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import FormControl from '@mui/material/FormControl'
import IconButton from '@mui/material/IconButton'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Select from '@mui/material/Select'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Tabs from '@mui/material/Tabs'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import DeleteIcon from '@mui/icons-material/Delete'
import {
  listMemberships,
  updateMembership,
  updateMembershipBandMember,
  removeMembership,
} from '../api/users.js'
import { listMembers } from '../api/bandMembers.js'
import { useAuth } from '../contexts/authContext.js'
import InvitesSection from '../components/InvitesSection.jsx'

const STATUS_COLOR = { pending: 'warning', approved: 'success', rejected: 'error' }

function MemberRowActions({ r, callerIsSuperAdmin, isSelf, cannotDelete, onStatus, onDelete }) {
  return (
    <>
      {r.status !== 'approved' && !(r.role === 'tenant_admin' && !callerIsSuperAdmin) && (
        <Button size="small" variant="contained" color="success" onClick={() => onStatus(r.user_id, 'approved')}>
          Approve
        </Button>
      )}
      {r.status !== 'approved' && r.role === 'tenant_admin' && !callerIsSuperAdmin && (
        <Tooltip title="Only super admins can approve a tenant_admin membership">
          <span>
            <Button size="small" variant="contained" color="success" disabled>Approve</Button>
          </span>
        </Tooltip>
      )}
      {r.status !== 'rejected' && !isSelf && !r.is_super_admin && (
        <Button size="small" variant="outlined" color="error" onClick={() => onStatus(r.user_id, 'rejected')}>
          Reject
        </Button>
      )}
      <Tooltip
        title={
          isSelf
            ? 'Cannot remove yourself'
            : r.is_super_admin
            ? 'Cannot remove a super admin'
            : r.role === 'tenant_admin' && !callerIsSuperAdmin
            ? 'Only super admins can remove a tenant admin'
            : 'Remove from this tenant'
        }
      >
        <span>
          <IconButton size="small" color="error" disabled={cannotDelete} aria-label="remove member" onClick={() => onDelete(r.user_id)}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    </>
  )
}

function MembersTable({ rows, bandMembers, currentUser, callerIsSuperAdmin, onStatus, onRole, onBandMember, onDelete }) {
  return (
    <>
      {/* Desktop table — hidden below 600 px */}
      <Paper variant="outlined" sx={{ display: { xs: 'none', sm: 'block' } }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell />
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Band member</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => {
              const isSelf = r.user_id === currentUser?.id
              const linked = r.band_member_id
              const availableMembers = bandMembers.filter(
                (bm) => !bm.user_id || bm.user_id === r.user_id,
              )
              const cannotDemoteAdmin =
                r.role === 'tenant_admin' && !callerIsSuperAdmin && !isSelf
              const cannotPromote = !callerIsSuperAdmin
              const cannotDelete =
                isSelf ||
                r.is_super_admin ||
                (r.role === 'tenant_admin' && !callerIsSuperAdmin)
              return (
                <TableRow key={r.user_id}>
                  <TableCell sx={{ width: 48 }}>
                    <Avatar src={r.picture_url} sx={{ width: 32, height: 32 }}>
                      {r.name?.[0]}
                    </Avatar>
                  </TableCell>
                  <TableCell>
                    {r.name}
                    {r.is_super_admin && (
                      <Chip size="small" label="super" color="primary" sx={{ ml: 1 }} />
                    )}
                  </TableCell>
                  <TableCell>{r.email}</TableCell>
                  <TableCell>
                    <Chip label={r.status} color={STATUS_COLOR[r.status] || 'default'} size="small" />
                  </TableCell>
                  <TableCell sx={{ minWidth: 140 }}>
                    <FormControl size="small" fullWidth>
                      <Select
                        value={r.role}
                        disabled={cannotDemoteAdmin || (cannotPromote && r.role === 'member')}
                        onChange={(e) => onRole(r.user_id, e.target.value)}
                      >
                        <MenuItem value="member">member</MenuItem>
                        <MenuItem value="tenant_admin" disabled={cannotPromote && r.role !== 'tenant_admin'}>
                          tenant_admin
                        </MenuItem>
                      </Select>
                    </FormControl>
                  </TableCell>
                  <TableCell sx={{ minWidth: 160 }}>
                    <FormControl size="small" fullWidth>
                      <Select
                        value={linked ?? ''}
                        displayEmpty
                        onChange={(e) => onBandMember(r.user_id, e.target.value || null)}
                      >
                        <MenuItem value="">— none —</MenuItem>
                        {availableMembers.map((bm) => (
                          <MenuItem key={bm.id} value={bm.id}>{bm.name}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </TableCell>
                  <TableCell align="right">
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ justifyContent: 'flex-end' }}
                    >
                      <MemberRowActions
                        r={r}
                        callerIsSuperAdmin={callerIsSuperAdmin}
                        isSelf={isSelf}
                        cannotDelete={cannotDelete}
                        onStatus={onStatus}
                        onDelete={onDelete}
                      />
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
        {rows.map((r) => {
          const isSelf = r.user_id === currentUser?.id
          const linked = r.band_member_id
          const availableMembers = bandMembers.filter(
            (bm) => !bm.user_id || bm.user_id === r.user_id,
          )
          const cannotDemoteAdmin = r.role === 'tenant_admin' && !callerIsSuperAdmin && !isSelf
          const cannotPromote = !callerIsSuperAdmin
          const cannotDelete = isSelf || r.is_super_admin || (r.role === 'tenant_admin' && !callerIsSuperAdmin)
          return (
            <Card key={r.user_id} variant="outlined">
              <CardContent sx={{ pb: 1 }}>
                <Stack
                  direction="row"
                  spacing={1.5}
                  sx={{ alignItems: 'center', mb: 1.5 }}
                >
                  <Avatar src={r.picture_url} sx={{ width: 36, height: 36 }}>
                    {r.name?.[0]}
                  </Avatar>
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Stack
                      direction="row"
                      spacing={0.5}
                      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <Typography variant="subtitle2" fontWeight={700}>{r.name}</Typography>
                      {r.is_super_admin && <Chip size="small" label="super" color="primary" />}
                    </Stack>
                    <Typography variant="caption" color="text.secondary" noWrap display="block">
                      {r.email}
                    </Typography>
                  </Box>
                  <Chip label={r.status} color={STATUS_COLOR[r.status] || 'default'} size="small" />
                </Stack>
                <Stack spacing={1}>
                  <FormControl size="small" fullWidth>
                    <Select
                      value={r.role}
                      disabled={cannotDemoteAdmin || (cannotPromote && r.role === 'member')}
                      onChange={(e) => onRole(r.user_id, e.target.value)}
                    >
                      <MenuItem value="member">member</MenuItem>
                      <MenuItem value="tenant_admin" disabled={cannotPromote && r.role !== 'tenant_admin'}>
                        tenant_admin
                      </MenuItem>
                    </Select>
                  </FormControl>
                  <FormControl size="small" fullWidth>
                    <Select
                      value={linked ?? ''}
                      displayEmpty
                      onChange={(e) => onBandMember(r.user_id, e.target.value || null)}
                    >
                      <MenuItem value="">— none —</MenuItem>
                      {availableMembers.map((bm) => (
                        <MenuItem key={bm.id} value={bm.id}>{bm.name}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Stack>
              </CardContent>
              <Divider />
              <CardActions sx={{ justifyContent: 'flex-end', px: 1, py: 0.5, gap: 0.5 }}>
                <MemberRowActions
                  r={r}
                  callerIsSuperAdmin={callerIsSuperAdmin}
                  isSelf={isSelf}
                  cannotDelete={cannotDelete}
                  onStatus={onStatus}
                  onDelete={onDelete}
                />
              </CardActions>
            </Card>
          )
        })}
      </Stack>
    </>
  )
}

export default function MembersPage() {
  const { user: currentUser } = useAuth()
  const [tab, setTab] = useState('members')
  const [rows, setRows] = useState([])
  const [bandMembers, setBandMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([listMemberships(), listMembers()]).then(([m, bm]) => {
      setRows(m)
      setBandMembers(bm)
      setLoading(false)
    })
  }, [])

  const replaceRow = (updated) => {
    setRows((prev) => prev.map((r) => (r.user_id === updated.user_id ? updated : r)))
  }

  const handleStatus = async (userId, status) => {
    setError('')
    try {
      const updated = await updateMembership(userId, { status })
      replaceRow(updated)
    } catch (err) {
      setError(err.message || 'Update failed')
    }
  }

  const handleRole = async (userId, role) => {
    setError('')
    try {
      const updated = await updateMembership(userId, { role })
      replaceRow(updated)
    } catch (err) {
      setError(err.message || 'Update failed')
    }
  }

  const handleBandMember = async (userId, band_member_id) => {
    setError('')
    try {
      const updated = await updateMembershipBandMember(userId, band_member_id || null)
      replaceRow(updated)
      const refreshed = await listMembers()
      setBandMembers(refreshed)
    } catch (err) {
      setError(err.message || 'Update failed')
    }
  }

  const handleDelete = async (userId) => {
    setError('')
    try {
      await removeMembership(userId)
      setRows((prev) => prev.filter((r) => r.user_id !== userId))
    } catch (err) {
      setError(err.message || 'Delete failed')
    }
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  const callerIsSuperAdmin = !!currentUser?.isSuperAdmin

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Typography variant="h5" fontWeight={700}>
        Members
      </Typography>
      <Tabs value={tab} onChange={(_, v) => setTab(v)}>
        <Tab value="members" label="Members" />
        <Tab value="invites" label="Invites" />
      </Tabs>
      {error && tab === 'members' && (
        <Typography color="error" variant="body2">
          {error}
        </Typography>
      )}
      {tab === 'members' ? (
        <MembersTable
          rows={rows}
          bandMembers={bandMembers}
          currentUser={currentUser}
          callerIsSuperAdmin={callerIsSuperAdmin}
          onStatus={handleStatus}
          onRole={handleRole}
          onBandMember={handleBandMember}
          onDelete={handleDelete}
        />
      ) : (
        <InvitesSection canIssueAdmin={callerIsSuperAdmin} />
      )}
    </Box>
  )
}
