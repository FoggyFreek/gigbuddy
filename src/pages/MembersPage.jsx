import { useEffect, useState } from 'react'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import FormControl from '@mui/material/FormControl'
import IconButton from '@mui/material/IconButton'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Select from '@mui/material/Select'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import DeleteIcon from '@mui/icons-material/Delete'
import { listUsers, updateUser, deleteUser } from '../api/users.js'
import { listMembers } from '../api/bandMembers.js'
import { useAuth } from '../contexts/authContext.js'

const STATUS_COLOR = { pending: 'warning', approved: 'success', rejected: 'error' }

export default function MembersPage() {
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState([])
  const [bandMembers, setBandMembers] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([listUsers(), listMembers()]).then(([u, bm]) => {
      setUsers(u)
      setBandMembers(bm)
      setLoading(false)
    })
  }, [])

  const handleStatus = async (id, status) => {
    const updated = await updateUser(id, { status })
    setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))
  }

  const handleBandMember = async (id, band_member_id) => {
    const updated = await updateUser(id, { band_member_id: band_member_id || null })
    setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))
  }

  const handleDelete = async (id) => {
    await deleteUser(id)
    setUsers((prev) => prev.filter((u) => u.id !== id))
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  const isAdmin = (u) => u.email === currentUser?.email

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Typography variant="h5" fontWeight={700}>
        Members
      </Typography>

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell />
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Band member</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((u) => {
              const adminRow = isAdmin(u)
              const linked = u.band_member_id
              const availableMembers = bandMembers.filter(
                (bm) => !bm.user_id || bm.user_id === u.id,
              )
              return (
                <TableRow key={u.id}>
                  <TableCell sx={{ width: 48 }}>
                    <Avatar src={u.picture_url} sx={{ width: 32, height: 32 }}>
                      {u.name?.[0]}
                    </Avatar>
                  </TableCell>
                  <TableCell>{u.name}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>
                    <Chip
                      label={u.status}
                      color={STATUS_COLOR[u.status] || 'default'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell sx={{ minWidth: 160 }}>
                    <FormControl size="small" fullWidth>
                      <Select
                        value={linked ?? ''}
                        displayEmpty
                        onChange={(e) => handleBandMember(u.id, e.target.value || null)}
                      >
                        <MenuItem value="">— none —</MenuItem>
                        {availableMembers.map((bm) => (
                          <MenuItem key={bm.id} value={bm.id}>
                            {bm.name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </TableCell>
                  <TableCell align="right">
                    <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                      {u.status !== 'approved' && (
                        <Button
                          size="small"
                          variant="contained"
                          color="success"
                          disabled={adminRow}
                          onClick={() => handleStatus(u.id, 'approved')}
                        >
                          Approve
                        </Button>
                      )}
                      {u.status !== 'rejected' && !adminRow && (
                        <Button
                          size="small"
                          variant="outlined"
                          color="error"
                          onClick={() => handleStatus(u.id, 'rejected')}
                        >
                          Reject
                        </Button>
                      )}
                      <Tooltip title={adminRow ? 'Cannot delete admin' : 'Delete user'}>
                        <span>
                          <IconButton
                            size="small"
                            color="error"
                            disabled={adminRow}
                            aria-label={adminRow ? 'Cannot delete admin' : 'Delete user'}
                            onClick={() => handleDelete(u.id)}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Box>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  )
}
