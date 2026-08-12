import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import GroupAddOutlinedIcon from '@mui/icons-material/GroupAddOutlined'
import CheckIcon from '@mui/icons-material/Check'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import type { BandMemberInput, Member } from '../types/entities.ts'
import { useThemeMode } from '../contexts/themeModeContext.ts'
import { usePermissions } from '../hooks/usePermissions.ts'
import { createMember, deleteMember, listMembers, updateMember } from '../api/bandMembers.ts'
import BandMemberDialog from './BandMemberDialog.tsx'

const POSITIONS = ['lead', 'optional', 'sub'] as const
type Position = typeof POSITIONS[number]
const POSITION_COLORS: Record<string, 'primary' | 'default' | 'warning'> = {
  lead: 'primary',
  optional: 'default',
  sub: 'warning',
}

function isPosition(position: string | undefined): position is Position {
  return position === 'lead' || position === 'optional' || position === 'sub'
}

interface BandMemberRowProps {
  member: Member
  sectionEditing: boolean
  onEdit: () => void
  onDelete: () => void
}

export default function BandMembersSection() {
  const { t } = useTranslation(['profile', 'common'])
  const navigate = useNavigate()
  const { canManageMembers, canWritePlanning } = usePermissions()
  const [members, setMembers] = useState<Member[]>([])
  const [editing, setEditing] = useState(false)
  const [dialogMember, setDialogMember] = useState<Member | 'new' | null>(null)

  useEffect(() => {
    listMembers().then(setMembers).catch(() => {})
  }, [])

  async function handleDialogSubmit(value: BandMemberInput) {
    if (!canWritePlanning) return
    if (dialogMember === 'new') {
      const created = await createMember(value)
      setMembers((current) => [...current, created])
      return
    }
    if (!dialogMember?.id) return
    const updated = await updateMember(dialogMember.id, value)
    setMembers((current) => current.map((member) => (
      member.id === dialogMember.id ? { ...member, ...value, ...updated } : member
    )))
  }

  async function handleDelete(id: Member['id']) {
    if (!canWritePlanning || id === undefined) return
    await deleteMember(id)
    setMembers((current) => current.filter((member) => member.id !== id))
  }

  function toggleEditing() {
    setEditing((current) => {
      if (current) setDialogMember(null)
      return !current
    })
  }

  const leads = members.filter((member) => member.position === 'lead')
  const showInviteCta = canManageMembers
    && leads.length > 0
    && leads.some((member) => member.user_id == null)

  return (
    <Paper variant="outlined" sx={{ p: 3, height: '100%' }}>
      <Stack direction="row" sx={{ mb: 2, alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t($ => $.members.title)}
        </Typography>
        {canWritePlanning && (
          <Button
            size="small"
            startIcon={editing ? <CheckIcon /> : <EditIcon />}
            onClick={toggleEditing}
            variant={editing ? 'contained' : 'outlined'}
            sx={{ ml: 2 }}
          >
            {editing
              ? t($ => $.actions.done, { ns: 'common' })
              : t($ => $.actions.edit, { ns: 'common' })}
          </Button>
        )}
      </Stack>

      <Stack spacing={2}>
        {members.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {editing ? t($ => $.members.emptyEditing) : t($ => $.members.emptyHint)}
          </Typography>
        )}

        {POSITIONS.map((position) => {
          const group = members.filter((member) => member.position === position)
          if (group.length === 0) return null
          return (
            <Box key={position}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}
              >
                {t($ => $.members.positions[position])}
              </Typography>
              <Stack spacing={1} sx={{ mt: 0.5 }}>
                {group.map((member) => (
                  <BandMemberRow
                    key={String(member.id)}
                    member={member}
                    sectionEditing={editing}
                    onEdit={() => setDialogMember(member)}
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
              onClick={() => navigate('/settings/members')}
            >
              {t($ => $.members.inviteCta)}
            </Button>
          </Box>
        )}

        {editing && (
          <Box>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setDialogMember('new')}
            >
              {t($ => $.members.add)}
            </Button>
          </Box>
        )}
      </Stack>

      {dialogMember && (
        <BandMemberDialog
          member={dialogMember === 'new' ? undefined : dialogMember}
          onSubmit={handleDialogSubmit}
          onClose={() => setDialogMember(null)}
        />
      )}
    </Paper>
  )
}

function BandMemberRow({
  member,
  sectionEditing,
  onEdit,
  onDelete,
}: Readonly<BandMemberRowProps>) {
  const { t } = useTranslation('profile')
  const { mode } = useThemeMode()
  const position = member.position

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      {member.user_id != null && (
        <Tooltip title={t($ => $.members.gigbuddyUser)}>
          <Box
            component="img"
            src="/icons/gigbuddy_logo_pick.png"
            alt={t($ => $.members.gigbuddyUser)}
            sx={{
              width: 16,
              height: 16,
              flexShrink: 0,
              filter: mode === 'dark' ? 'invert(1)' : 'none',
            }}
          />
        </Tooltip>
      )}
      <Box
        sx={{
          width: 16,
          height: 16,
          borderRadius: '50%',
          bgcolor: member.color || 'grey.400',
          flexShrink: 0,
        }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>{member.name}</Typography>
          {Boolean(member.roles?.length) && (
            <Typography variant="caption" color="text.secondary">
              ({member.roles?.join(', ')})
            </Typography>
          )}
        </Stack>
      </Box>
      <Chip
        label={isPosition(position) ? t($ => $.members.positions[position]) : position}
        color={POSITION_COLORS[position ?? ''] ?? 'default'}
        size="small"
        sx={{ height: 18, fontSize: '0.65rem' }}
      />
      {sectionEditing && (
        <>
          <Tooltip title={t($ => $.members.edit)}>
            <IconButton size="small" onClick={onEdit}>
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
