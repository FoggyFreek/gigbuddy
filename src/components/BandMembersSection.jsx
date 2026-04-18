import { useCallback, useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import CheckIcon from '@mui/icons-material/Check'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'

const POSITION_LABELS = { lead: 'Lead', optional: 'Optional', sub: 'Sub' }
const POSITION_COLORS = { lead: 'primary', optional: 'default', sub: 'warning' }
import useDebouncedSave from '../hooks/useDebouncedSave.js'
import { createMember, deleteMember, listMembers, updateMember } from '../api/bandMembers.js'

const PALETTE = [
  '#e53935', '#e91e63', '#8e24aa', '#1e88e5',
  '#00897b', '#43a047', '#f4511e', '#6d4c41',
]

export default function BandMembersSection() {
  const [members, setMembers] = useState([])
  const [newMember, setNewMember] = useState({ name: '', role: '', position: 'lead' })
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    listMembers().then(setMembers).catch(() => {})
  }, [])

  async function handleAdd() {
    if (!newMember.name.trim() || adding) return
    setAdding(true)
    try {
      const created = await createMember({ name: newMember.name.trim(), role: newMember.role.trim() || null, position: newMember.position })
      setMembers((prev) => [...prev, created])
      setNewMember({ name: '', role: '', position: 'lead' })
    } finally {
      setAdding(false)
    }
  }

  async function handleDelete(id) {
    await deleteMember(id)
    setMembers((prev) => prev.filter((m) => m.id !== id))
  }

  function handleChange(id, patch) {
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  }

  return (
    <Paper variant="outlined" sx={{ p: 3, height: '100%' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          Band members
        </Typography>
        <Button
          size="small"
          startIcon={editing ? <CheckIcon /> : <EditIcon />}
          onClick={() => setEditing((v) => !v)}
          variant={editing ? 'contained' : 'outlined'}
          sx={{ ml: 2 }}
        >
          {editing ? 'Done' : 'Edit'}
        </Button>
      </Stack>

      <Stack spacing={2}>
        {members.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No members yet.{editing ? '' : ' Click Edit to add one.'}
          </Typography>
        )}

        {['lead', 'optional', 'sub'].map((pos) => {
          const group = members.filter((m) => m.position === pos)
          if (group.length === 0) return null
          return (
            <Box key={pos}>
              <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {POSITION_LABELS[pos]}
              </Typography>
              <Stack spacing={1} sx={{ mt: 0.5 }}>
                {group.map((member) => (
                  <BandMemberRow
                    key={member.id}
                    member={member}
                    sectionEditing={editing}
                    onChange={(patch) => handleChange(member.id, patch)}
                    onDelete={() => handleDelete(member.id)}
                  />
                ))}
              </Stack>
            </Box>
          )
        })}

        {editing && (
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <TextField
              label="Name"
              size="small"
              value={newMember.name}
              onChange={(e) => setNewMember((p) => ({ ...p, name: e.target.value }))}
              sx={{ flex: 2, minWidth: 120 }}
            />
            <TextField
              label="Role"
              size="small"
              value={newMember.role}
              onChange={(e) => setNewMember((p) => ({ ...p, role: e.target.value }))}
              sx={{ flex: 2, minWidth: 120 }}
              placeholder="Guitar, Vocals…"
            />
            <TextField
              select
              label="Position"
              size="small"
              value={newMember.position}
              onChange={(e) => setNewMember((p) => ({ ...p, position: e.target.value }))}
              sx={{ flex: 1, minWidth: 100 }}
            >
              <MenuItem value="lead">Lead</MenuItem>
              <MenuItem value="optional">Optional</MenuItem>
              <MenuItem value="sub">Sub</MenuItem>
            </TextField>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={handleAdd}
              disabled={!newMember.name.trim() || adding}
              sx={{ height: 40, whiteSpace: 'nowrap' }}
            >
              Add member
            </Button>
          </Box>
        )}
      </Stack>
    </Paper>
  )
}

function BandMemberRow({ member, sectionEditing, onChange, onDelete }) {
  const [editing, setEditing] = useState(false)
  const saveFn = useCallback(
    async (patch) => { await updateMember(member.id, patch) },
    [member.id]
  )
  const { schedule } = useDebouncedSave(saveFn)

  function handle(field, value) {
    onChange({ [field]: value })
    schedule({ [field]: value })
  }

  function handleColorClick(color) {
    onChange({ color })
    updateMember(member.id, { color }).catch(() => {})
  }

  if (!editing) {
    return (
      <Stack direction="row" spacing={1} alignItems="center">
        <Box
          sx={{
            width: 16, height: 16, borderRadius: '50%',
            bgcolor: member.color || 'grey.400', flexShrink: 0,
          }}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Typography variant="body2" fontWeight={500}>{member.name}</Typography>
            {member.role && (
              <Typography variant="caption" color="text.secondary">({member.role})</Typography>
            )}
            <Chip
              label={POSITION_LABELS[member.position] ?? member.position}
              color={POSITION_COLORS[member.position] ?? 'default'}
              size="small"
              sx={{ height: 18, fontSize: '0.65rem' }}
            />
          </Stack>
        </Box>
        {sectionEditing && (
          <>
            <Tooltip title="Edit member">
              <IconButton size="small" onClick={() => setEditing(true)}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete member">
              <IconButton onClick={onDelete} color="error" size="small">
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        )}
      </Stack>
    )
  }

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} alignItems="center">
        <TextField
          label="Name"
          size="small"
          value={member.name}
          onChange={(e) => handle('name', e.target.value)}
          sx={{ flex: 2 }}
        />
        <TextField
          label="Role"
          size="small"
          value={member.role || ''}
          onChange={(e) => handle('role', e.target.value)}
          sx={{ flex: 2 }}
        />
        <TextField
          select
          label="Position"
          size="small"
          value={member.position ?? 'lead'}
          onChange={(e) => handle('position', e.target.value)}
          sx={{ flex: 1, minWidth: 100 }}
        >
          <MenuItem value="lead">Lead</MenuItem>
          <MenuItem value="optional">Optional</MenuItem>
          <MenuItem value="sub">Sub</MenuItem>
        </TextField>
        <Tooltip title="Done editing">
          <IconButton size="small" onClick={() => setEditing(false)} color="primary">
            <CheckIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete member">
          <IconButton onClick={onDelete} color="error" size="small">
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      <Stack direction="row" spacing={0.5} sx={{ pl: 0.5 }}>
        {PALETTE.map((color) => (
          <Box
            key={color}
            onClick={() => handleColorClick(color)}
            aria-label={`color ${color}`}
            sx={{
              width: 20, height: 20, borderRadius: '50%', bgcolor: color,
              cursor: 'pointer', border: member.color === color ? '2px solid' : '2px solid transparent',
              borderColor: member.color === color ? 'text.primary' : 'transparent',
            }}
          />
        ))}
      </Stack>
    </Stack>
  )
}
