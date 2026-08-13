import { useTranslation } from 'react-i18next'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import EditIcon from '@mui/icons-material/Edit'
import {
  BAND_MEMBER_ROLE_OPTIONS,
  type BandMemberRole,
} from '../bandMemberRoles.ts'

export type MemberRolesMode = 'view' | 'edit'

interface Props {
  roles: readonly BandMemberRole[]
  mode?: MemberRolesMode
  canEdit?: boolean
  onEdit?: () => void
  onChange: (roles: BandMemberRole[]) => void
}

function moveRole(roles: readonly BandMemberRole[], index: number, direction: -1 | 1) {
  const target = index + direction
  if (target < 0 || target >= roles.length) return [...roles]
  const reordered = [...roles]
  const [role] = reordered.splice(index, 1)
  reordered.splice(target, 0, role)
  return reordered
}

export default function MemberRolesControl({
  roles,
  mode = 'edit',
  canEdit = true,
  onEdit,
  onChange,
}: Readonly<Props>) {
  const { t } = useTranslation(['profile', 'common'])

  function handleRolesChange(_event: React.SyntheticEvent, selected: BandMemberRole[]) {
    onChange([
      ...roles.filter((role) => selected.includes(role)),
      ...selected.filter((role) => !roles.includes(role)),
    ])
  }

  if (mode === 'view') {
    return (
      <Stack spacing={1.5}>
        {roles.length > 0 ? (
          <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap' }}>
            {roles.map((role) => <Chip key={role} label={role} size="small" />)}
          </Stack>
        ) : (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t($ => $.members.noRoles)}
          </Typography>
        )}
        {canEdit && onEdit && (
          <Box>
            <Button size="small" variant="outlined" startIcon={<EditIcon />} onClick={onEdit}>
              {t($ => $.actions.edit, { ns: 'common' })}
            </Button>
          </Box>
        )}
      </Stack>
    )
  }

  return (
    <Stack spacing={1.5}>
      <Autocomplete<BandMemberRole, true>
        multiple
        disableCloseOnSelect
        options={BAND_MEMBER_ROLE_OPTIONS}
        value={[...roles]}
        onChange={handleRolesChange}
        renderInput={(params) => (
          <TextField {...params} label={t($ => $.members.roles)} />
        )}
      />
      {roles.length > 0 && (
        <Box>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t($ => $.members.rolesOrderHelp)}
          </Typography>
          <Stack spacing={0.5} sx={{ mt: 0.5 }}>
            {roles.map((role, index) => (
              <Stack key={role} direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                <Typography variant="body2" sx={{ flex: 1 }}>
                  {index + 1}. {role}
                </Typography>
                <IconButton
                  size="small"
                  aria-label={t($ => $.members.moveRoleUp, { role })}
                  disabled={index === 0}
                  onClick={() => onChange(moveRole(roles, index, -1))}
                >
                  <ArrowUpwardIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  aria-label={t($ => $.members.moveRoleDown, { role })}
                  disabled={index === roles.length - 1}
                  onClick={() => onChange(moveRole(roles, index, 1))}
                >
                  <ArrowDownwardIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))}
          </Stack>
        </Box>
      )}
    </Stack>
  )
}
