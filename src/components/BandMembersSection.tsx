import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
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
import GroupAddOutlinedIcon from '@mui/icons-material/GroupAddOutlined'
import CheckIcon from '@mui/icons-material/Check'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import type { Member } from '../types/entities.ts'
import { useThemeMode } from '../contexts/themeModeContext.ts'
import useDebouncedSave from '../hooks/useDebouncedSave.ts'
import { usePermissions } from '../hooks/usePermissions.ts'
import { createMember, deleteMember, listMembers, updateMember } from '../api/bandMembers.ts'

const POSITIONS = ['lead', 'optional', 'sub'] as const
type Position = typeof POSITIONS[number]
const POSITION_COLORS: Record<string, 'primary' | 'default' | 'warning'> = { lead: 'primary', optional: 'default', sub: 'warning' }

function isPosition(p: string | undefined): p is Position {
  return p === 'lead' || p === 'optional' || p === 'sub'
}

const PALETTE = [
  '#e53935', '#e91e63', '#8e24aa', '#1e88e5',
  '#00897b', '#43a047', '#f4511e', '#6d4c41',
]

type MemberWithRole = Member & { role?: string }

interface BandMemberRowProps {
  member: MemberWithRole
  sectionEditing: boolean
  onChange: (patch: Partial<MemberWithRole>) => void
  onDelete: () => void
}

export default function BandMembersSection() {
  const { t } = useTranslation(['profile', 'common'])
  const navigate = useNavigate()
  const { canManageMembers } = usePermissions()
  const [members, setMembers] = useState<MemberWithRole[]>([])
  const [newMember, setNewMember] = useState<{ name: string; role: string; position: string }>({ name: '', role: '', position: 'lead' })
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    listMembers().then(setMembers).catch(() => {})
  }, [])

  async function handleAdd() {
    if (!newMember.name.trim() || adding) return
    setAdding(true)
    try {
      const created = await createMember({ name: newMember.name.trim(), role: newMember.role.trim() || null, position: newMember.position } as Partial<MemberWithRole>)
      setMembers((prev) => [...prev, created])
      setNewMember({ name: '', role: '', position: 'lead' })
    } finally {
      setAdding(false)
    }
  }

  async function handleDelete(id: MemberWithRole['id']) {
    if (id === undefined) return
    await deleteMember(id)
    setMembers((prev) => prev.filter((m) => m.id !== id))
  }

  function handleChange(id: MemberWithRole['id'], patch: Partial<MemberWithRole>) {
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  }

  const leads = members.filter((m) => m.position === 'lead')
  const showInviteCta = canManageMembers && leads.length > 0 && leads.some((m) => m.user_id == null)

  return (
    <Paper variant="outlined" sx={{ p: 3, height: '100%' }}>
      <Stack direction="row" sx={{ mb: 2, alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t($ => $.members.title)}
        </Typography>
        <Button
          size="small"
          startIcon={editing ? <CheckIcon /> : <EditIcon />}
          onClick={() => setEditing((v) => !v)}
          variant={editing ? 'contained' : 'outlined'}
          sx={{ ml: 2 }}
        >
          {editing ? t($ => $.actions.done, { ns: 'common' }) : t($ => $.actions.edit, { ns: 'common' })}
        </Button>
      </Stack>

      <Stack spacing={2}>
        {members.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {editing ? t($ => $.members.emptyEditing) : t($ => $.members.emptyHint)}
          </Typography>
        )}

        {POSITIONS.map((pos) => {
          const group = members.filter((m) => m.position === pos)
          if (group.length === 0) return null
          return (
            <Box key={pos}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {t($ => $.members.positions[pos])}
              </Typography>
              <Stack spacing={1} sx={{ mt: 0.5 }}>
                {group.map((member) => (
                  <BandMemberRow
                    key={String(member.id)}
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

        {showInviteCta && !editing && (
          <Box>
            <Button
              size="small"
              variant="outlined"
              startIcon={<GroupAddOutlinedIcon />}
              onClick={() => navigate('/settings/invites')}
            >
              {t($ => $.members.inviteCta)}
            </Button>
          </Box>
        )}

        {editing && (
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <TextField
              label={t($ => $.members.name)}
              size="small"
              value={newMember.name}
              onChange={(e) => setNewMember((p) => ({ ...p, name: e.target.value }))}
              sx={{ flex: 2, minWidth: 120 }}
            />
            <TextField
              label={t($ => $.members.role)}
              size="small"
              value={newMember.role}
              onChange={(e) => setNewMember((p) => ({ ...p, role: e.target.value }))}
              sx={{ flex: 2, minWidth: 120 }}
              placeholder={t($ => $.members.rolePlaceholder)}
            />
            <TextField
              select
              label={t($ => $.members.position)}
              size="small"
              value={newMember.position}
              onChange={(e) => setNewMember((p) => ({ ...p, position: e.target.value }))}
              sx={{ flex: 1, minWidth: 100 }}
            >
              <MenuItem value="lead">{t($ => $.members.positions.lead)}</MenuItem>
              <MenuItem value="optional">{t($ => $.members.positions.optional)}</MenuItem>
              <MenuItem value="sub">{t($ => $.members.positions.sub)}</MenuItem>
            </TextField>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={handleAdd}
              disabled={!newMember.name.trim() || adding}
              sx={{ height: 40, whiteSpace: 'nowrap' }}
            >
              {t($ => $.members.add)}
            </Button>
          </Box>
        )}
      </Stack>
    </Paper>
  )
}

function BandMemberRow({ member, sectionEditing, onChange, onDelete }: Readonly<BandMemberRowProps>) {
  const { t } = useTranslation('profile')
  const { mode } = useThemeMode()
  const [editing, setEditing] = useState(false)
  const saveFn = useCallback(
    async (patch: Partial<MemberWithRole>) => { await updateMember(member.id!, patch) },
    [member.id]
  )
  const { schedule } = useDebouncedSave(saveFn)

  function handle(field: keyof MemberWithRole, value: string) {
    onChange({ [field]: value })
    schedule({ [field]: value })
  }

  function handleColorClick(color: string) {
    onChange({ color })
    updateMember(member.id!, { color }).catch(() => {})
  }

  const position = member.position

  if (!editing) {
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        {member.user_id != null && (
          <Tooltip title={t($ => $.members.gigbuddyUser)}>
            <Box
              component="img"
              src="/icons/gigbuddy_logo_pick.png"
              alt={t($ => $.members.gigbuddyUser)}
              sx={{
                width: 16, height: 16, flexShrink: 0,
                filter: mode === 'dark' ? 'invert(1)' : 'none',
              }}
            />
          </Tooltip>
        )}
        <Box
          sx={{
            width: 16, height: 16, borderRadius: '50%',
            bgcolor: member.color || 'grey.400', flexShrink: 0,
          }}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>{member.name}</Typography>
            {member.role && (
              <Typography variant="caption" color="text.secondary">({member.role})</Typography>
            )}
          </Stack>
        </Box>
        <Chip
          label={isPosition(position) ? t($ => $.members.positions[position]) : position}
          color={POSITION_COLORS[member.position ?? ''] ?? 'default'}
          size="small"
          sx={{ height: 18, fontSize: '0.65rem' }}
        />
        {sectionEditing && (
          <>
            <Tooltip title={t($ => $.members.edit)}>
              <IconButton size="small" onClick={() => setEditing(true)}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={t($ => $.members.delete)}>
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
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <TextField
          label={t($ => $.members.name)}
          size="small"
          value={member.name}
          onChange={(e) => handle('name', e.target.value)}
          sx={{ flex: 2 }}
        />
        <TextField
          label={t($ => $.members.role)}
          size="small"
          value={member.role || ''}
          onChange={(e) => handle('role', e.target.value)}
          sx={{ flex: 2 }}
        />
        <TextField
          select
          label={t($ => $.members.position)}
          size="small"
          value={member.position ?? 'lead'}
          onChange={(e) => handle('position', e.target.value)}
          sx={{ flex: 1, minWidth: 100 }}
        >
          <MenuItem value="lead">{t($ => $.members.positions.lead)}</MenuItem>
          <MenuItem value="optional">{t($ => $.members.positions.optional)}</MenuItem>
          <MenuItem value="sub">{t($ => $.members.positions.sub)}</MenuItem>
        </TextField>
        <Tooltip title={t($ => $.members.doneEditing)}>
          <IconButton size="small" onClick={() => setEditing(false)} color="primary">
            <CheckIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t($ => $.members.delete)}>
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
            aria-label={t($ => $.members.colorAria, { color })}
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
