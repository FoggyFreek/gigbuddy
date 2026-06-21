import { useEffect, useState } from 'react'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardActions from '@mui/material/CardActions'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import DeleteIcon from '@mui/icons-material/Delete'
import { listAllUsers, deleteUserGlobal } from '../../api/adminUsers.ts'
import { useAuth } from '../../contexts/authContext.ts'
import type { Id } from '../../types/entities.ts'

interface AdminUser {
  id?: Id
  name?: string
  email?: string
  picture_url?: string
  status?: string
  is_super_admin?: boolean
  memberships?: Array<{
    tenant_id?: Id
    tenant_slug?: string
    role?: string
    status?: string
  }>
}

const ROLE_COLOR: Record<string, 'primary' | 'default'> = { tenant_admin: 'primary', member: 'default' }
const STATUS_COLOR: Record<string, 'warning' | 'success' | 'error'> = { pending: 'warning', approved: 'success', rejected: 'error' }

export default function AdminUsersPage() {
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    listAllUsers()
      .then((rows) => setUsers(rows))
      .finally(() => setLoading(false))
  }, [])

  const handleDelete = async (id: Id) => {
    setError('')
    try {
      await deleteUserGlobal(id)
      setUsers((prev) => prev.filter((u) => u.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
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
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        All Users
      </Typography>
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
              <TableCell />
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Memberships</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((u) => {
              const isSelf = u.id === currentUser?.id
              const cannotDelete = isSelf || u.is_super_admin
              let deleteTooltip: string
              if (isSelf) {
                deleteTooltip = 'Cannot delete yourself'
              } else if (u.is_super_admin) {
                deleteTooltip = 'Cannot delete a super admin via this UI'
              } else {
                deleteTooltip = 'Delete user'
              }
              return (
                <TableRow key={String(u.id)}>
                  <TableCell sx={{ width: 48 }}>
                    <Avatar src={u.picture_url} sx={{ width: 32, height: 32 }}>
                      {u.name?.[0]}
                    </Avatar>
                  </TableCell>
                  <TableCell>
                    {u.name}
                    {u.is_super_admin && (
                      <Chip size="small" label="super" color="primary" sx={{ ml: 1 }} />
                    )}
                  </TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>
                    <Chip size="small" label={u.status} color={STATUS_COLOR[u.status ?? ''] || 'default'} />
                  </TableCell>
                  <TableCell>
                    <Stack
                      direction="row"
                      spacing={0.5}
                      useFlexGap
                      sx={{ flexWrap: 'wrap' }}
                    >
                      {(u.memberships || []).map((m) => (
                        <Chip
                          key={`${u.id}-${m.tenant_id}`}
                          size="small"
                          label={`${m.tenant_slug} · ${m.role} · ${m.status}`}
                          color={ROLE_COLOR[m.role ?? ''] || 'default'}
                          variant="outlined"
                        />
                      ))}
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip
                      title={deleteTooltip}
                    >
                      <span>
                        <IconButton
                          size="small"
                          color="error"
                          disabled={cannotDelete}
                          aria-label="delete user"
                          onClick={() => u.id != null && handleDelete(u.id)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Paper>

      {/* Mobile cards — visible below 600 px */}
      <Stack spacing={1.5} sx={{ display: { xs: 'flex', sm: 'none' } }}>
        {users.map((u) => {
          const isSelf = u.id === currentUser?.id
          const cannotDelete = isSelf || u.is_super_admin
          let deleteTooltip: string
          if (isSelf) {
            deleteTooltip = 'Cannot delete yourself'
          } else if (u.is_super_admin) {
            deleteTooltip = 'Cannot delete a super admin via this UI'
          } else {
            deleteTooltip = 'Delete user'
          }
          return (
            <Card key={String(u.id)} variant="outlined">
              <CardContent sx={{ pb: 1 }}>
                <Stack
                  direction="row"
                  spacing={1.5}
                  sx={{ alignItems: 'center', mb: 1 }}
                >
                  <Avatar src={u.picture_url} sx={{ width: 36, height: 36 }}>
                    {u.name?.[0]}
                  </Avatar>
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Stack
                      direction="row"
                      spacing={0.5}
                      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{u.name}</Typography>
                      {u.is_super_admin && <Chip size="small" label="super" color="primary" />}
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {u.email}
                    </Typography>
                  </Box>
                  <Chip size="small" label={u.status} color={STATUS_COLOR[u.status ?? ''] || 'default'} />
                </Stack>
                {(u.memberships || []).length > 0 && (
                  <Stack
                    direction="row"
                    spacing={0.5}
                    useFlexGap
                    sx={{ flexWrap: 'wrap' }}
                  >
                    {(u.memberships || []).map((m) => (
                      <Chip
                        key={`${u.id}-${m.tenant_id}`}
                        size="small"
                        label={`${m.tenant_slug} · ${m.role} · ${m.status}`}
                        color={ROLE_COLOR[m.role ?? ''] || 'default'}
                        variant="outlined"
                      />
                    ))}
                  </Stack>
                )}
              </CardContent>
              <Divider />
              <CardActions sx={{ justifyContent: 'flex-end', px: 1, py: 0.5 }}>
                <Tooltip
                  title={deleteTooltip}
                >
                  <span>
                    <IconButton
                      size="small"
                      color="error"
                      disabled={cannotDelete}
                      aria-label="delete user"
                      onClick={() => u.id != null && handleDelete(u.id)}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </CardActions>
            </Card>
          )
        })}
      </Stack>
    </Box>
  )
}
