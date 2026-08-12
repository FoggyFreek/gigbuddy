import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import type { BandMemberInput, Member } from '../types/entities.ts'
import {
  BAND_MEMBER_ROLE_OPTIONS,
  type BandMemberRole,
} from '../utils/bandMemberRoles.ts'

const PALETTE = [
  '#e53935', '#e91e63', '#8e24aa', '#1e88e5',
  '#00897b', '#43a047', '#f4511e', '#6d4c41',
]

interface Props {
  member?: Member
  onClose: () => void
  onSubmit: (value: BandMemberInput) => Promise<void>
}

function moveRole(roles: BandMemberRole[], index: number, direction: -1 | 1) {
  const target = index + direction
  if (target < 0 || target >= roles.length) return roles
  const reordered = [...roles]
  const [role] = reordered.splice(index, 1)
  reordered.splice(target, 0, role)
  return reordered
}

export default function BandMemberDialog({ member, onClose, onSubmit }: Readonly<Props>) {
  const { t } = useTranslation(['profile', 'common'])
  const [name, setName] = useState(member?.name ?? '')
  const [roles, setRoles] = useState<BandMemberRole[]>(member?.roles ?? [])
  const [position, setPosition] = useState(member?.position ?? 'lead')
  const [color, setColor] = useState<string | null>(member?.color ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  function handleRolesChange(_event: React.SyntheticEvent, selected: BandMemberRole[]) {
    setRoles((current) => [
      ...current.filter((role) => selected.includes(role)),
      ...selected.filter((role) => !current.includes(role)),
    ])
  }

  async function handleSubmit() {
    if (!name.trim() || busy) return
    setBusy(true)
    setError(false)
    try {
      await onSubmit({ name: name.trim(), roles, color, position })
      onClose()
    } catch {
      setError(true)
      setBusy(false)
    }
  }

  const title = member
    ? t($ => $.members.editDialogTitle)
    : t($ => $.members.addDialogTitle)

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{t($ => $.members.saveError)}</Alert>}
          <TextField
            label={t($ => $.members.name)}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            fullWidth
          />
          <Autocomplete<BandMemberRole, true>
            multiple={true}
            disableCloseOnSelect
            options={BAND_MEMBER_ROLE_OPTIONS}
            value={roles}
            onChange={handleRolesChange}
            renderInput={(params) => (
              <TextField {...params} label={t($ => $.members.roles)} />
            )}
          />
          {roles.length > 0 && (
            <Box>
              <Typography variant="caption" color="text.secondary">
                {t($ => $.members.rolesOrderHelp)}
              </Typography>
              <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                {roles.map((role, index) => (
                  <Stack
                    key={role}
                    direction="row"
                    spacing={0.5}
                    sx={{ alignItems: 'center' }}
                  >
                    <Typography variant="body2" sx={{ flex: 1 }}>
                      {index + 1}. {role}
                    </Typography>
                    <IconButton
                      size="small"
                      aria-label={t($ => $.members.moveRoleUp, { role })}
                      disabled={index === 0}
                      onClick={() => setRoles((current) => moveRole(current, index, -1))}
                    >
                      <ArrowUpwardIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label={t($ => $.members.moveRoleDown, { role })}
                      disabled={index === roles.length - 1}
                      onClick={() => setRoles((current) => moveRole(current, index, 1))}
                    >
                      <ArrowDownwardIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                ))}
              </Stack>
            </Box>
          )}
          <TextField
            select
            label={t($ => $.members.position)}
            value={position}
            onChange={(event) => setPosition(event.target.value)}
          >
            <MenuItem value="lead">{t($ => $.members.positions.lead)}</MenuItem>
            <MenuItem value="optional">{t($ => $.members.positions.optional)}</MenuItem>
            <MenuItem value="sub">{t($ => $.members.positions.sub)}</MenuItem>
          </TextField>
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t($ => $.members.color)}
            </Typography>
            <Stack direction="row" spacing={0.75} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
              {PALETTE.map((swatch) => (
                <Box
                  key={swatch}
                  component="button"
                  type="button"
                  onClick={() => setColor(swatch)}
                  aria-label={t($ => $.members.colorAria, { color: swatch })}
                  sx={{
                    width: 28,
                    height: 28,
                    p: 0,
                    borderRadius: '50%',
                    bgcolor: swatch,
                    cursor: 'pointer',
                    border: '2px solid',
                    borderColor: color === swatch ? 'text.primary' : 'transparent',
                  }}
                />
              ))}
            </Stack>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {t($ => $.actions.cancel, { ns: 'common' })}
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={!name.trim() || busy}
        >
          {member
            ? t($ => $.actions.save, { ns: 'common' })
            : t($ => $.members.addAction)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
