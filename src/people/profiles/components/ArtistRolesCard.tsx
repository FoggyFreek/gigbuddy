import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import CheckIcon from '@mui/icons-material/Check'
import EditIcon from '@mui/icons-material/Edit'
import type { Member } from '../../../types/entities.ts'
import type { BandMemberRole } from '../../memberships/bandMemberRoles.ts'
import { listMembers, updateMember } from '../../memberships/bandMembers.ts'
import MemberRolesControl from '../../memberships/components/MemberRolesControl.tsx'
import useDebouncedSave from '../../../hooks/useDebouncedSave.ts'
import SaveStatusLabel from '../../../components/SaveStatusLabel.tsx'

type RolesPatch = {
  roles: BandMemberRole[]
}

interface Props {
  canWrite?: boolean
}

export default function ArtistRolesCard({ canWrite = true }: Readonly<Props>) {
  const { t } = useTranslation(['profile', 'common'])
  const [member, setMember] = useState<Member | null>(null)
  const [roles, setRoles] = useState<BandMemberRole[]>([])
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    listMembers()
      .then((members) => {
        const fixedMember = members[0]
        if (!fixedMember) {
          setLoadError(true)
          return
        }
        setMember(fixedMember)
        setRoles(fixedMember.roles ?? [])
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }, [])

  const saveRoles = useCallback(async (patch: RolesPatch) => {
    if (member?.id == null) return
    const updated = await updateMember(member.id, patch)
    setMember((current) => current ? { ...current, ...updated, roles: patch.roles } : current)
  }, [member])
  const { schedule, flush, status } = useDebouncedSave<RolesPatch>(saveRoles)

  function handleChange(nextRoles: BandMemberRole[]) {
    if (!canWrite || member?.id == null) return
    setRoles(nextRoles)
    schedule({ roles: nextRoles })
  }

  async function handleDone() {
    await flush()
    setEditing(false)
  }

  return (
    <Paper variant="outlined" sx={{ p: 3, height: '100%' }}>
      <Stack direction="row" sx={{ mb: 2, alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t($ => $.artistRoles.title)}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <SaveStatusLabel status={status} />
          {canWrite && (
            <Button
              size="small"
              variant={editing ? 'contained' : 'outlined'}
              startIcon={editing ? <CheckIcon /> : <EditIcon />}
              onClick={editing ? handleDone : () => setEditing(true)}
            >
              {editing
                ? t($ => $.actions.done, { ns: 'common' })
                : t($ => $.actions.edit, { ns: 'common' })}
            </Button>
          )}
        </Stack>
      </Stack>

      {loading && <CircularProgress size={24} />}
      {loadError && <Alert severity="error">{t($ => $.artistRoles.loadError)}</Alert>}
      {!loading && !loadError && (
        <MemberRolesControl
          roles={roles}
          mode={editing ? 'edit' : 'view'}
          canEdit={false}
          onChange={handleChange}
        />
      )}
    </Paper>
  )
}
