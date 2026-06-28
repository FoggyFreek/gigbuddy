import { useTranslation } from 'react-i18next'
import type { SxProps } from '@mui/material/styles'
import type { SocialEntry, ProfileForm } from './profileForm.ts'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import CheckIcon from '@mui/icons-material/Check'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import EditIcon from '@mui/icons-material/Edit'
import { SOCIALS } from './profileForm.ts'

interface CopyButtonProps {
  copied?: boolean
  label: string
  onCopy: () => void
  small?: boolean
}

function CopyButton({ copied, label, onCopy, small }: CopyButtonProps) {
  const { t } = useTranslation('profile')
  const iconSx: SxProps | undefined = small ? { fontSize: 14 } : undefined
  const fontSize = small ? undefined : ('small' as const)
  return (
    <Tooltip title={copied ? t($ => $.socials.copied) : t($ => $.socials.copy)}>
      <IconButton
        size="small"
        onClick={onCopy}
        sx={small ? { color: 'inherit', p: 0.25 } : undefined}
        aria-label={t($ => $.socials.copyAria, { label })}
      >
        {copied
          ? <CheckIcon sx={iconSx} fontSize={fontSize} />
          : <ContentCopyIcon sx={iconSx} fontSize={fontSize} />}
      </IconButton>
    </Tooltip>
  )
}

interface SocialViewProps {
  social: SocialEntry
  handle?: string
  copied?: boolean
  onCopy: () => void
}

function SocialView({ social, handle, copied, onCopy }: SocialViewProps) {
  const { Icon } = social
  return (
    <Stack direction="row" spacing={1.5} sx={{ py: 0.5, alignItems: 'center' }}>
      <Box sx={{ display: 'grid', placeItems: 'center' }}>
        <Icon fontSize="small" color="action" />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary">{social.label}</Typography>
        <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
          {handle ? social.prefix + handle : '—'}
        </Typography>
      </Box>
      {handle && <CopyButton copied={copied} label={social.label} onCopy={onCopy} />}
    </Stack>
  )
}

interface SocialEditFieldProps {
  social: SocialEntry
  handle?: string
  copied?: boolean
  onChange: (field: string, value: string) => void
  onCopy: () => void
}

function SocialEditField({ social, handle, copied, onChange, onCopy }: SocialEditFieldProps) {
  const { t } = useTranslation('profile')
  const { Icon } = social
  return (
    <TextField
      label={social.label}
      fullWidth
      value={handle}
      onChange={(e) => onChange(social.field, e.target.value)}
      placeholder={t($ => $.socials.handlePlaceholder)}
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <Box sx={{ display: 'grid', placeItems: 'center' }}>
                <Icon fontSize="small" />
              </Box>
            </InputAdornment>
          ),
        },
      }}
      helperText={(
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
          <span>{social.prefix + (handle || '…')}</span>
          {handle && <CopyButton copied={copied} label={social.label} onCopy={onCopy} small />}
        </Box>
      )}
    />
  )
}

interface ProfileSocialsTabProps {
  form: ProfileForm
  editing?: boolean
  onToggleEditing: () => void
  onChange: (field: string, value: string) => void
  copiedField?: string
  onCopy: (field: string, url: string) => void
}

export default function ProfileSocialsTab({ form, editing, onToggleEditing, onChange, copiedField, onCopy }: ProfileSocialsTabProps) {
  const { t } = useTranslation('common')
  return (
    <Box sx={{ p: 3 }}>
      

      <Grid container spacing={2}>
        {SOCIALS.map((social) => {
          const handle = form[social.field as keyof ProfileForm] as string
          const copied = copiedField === social.field
          const onCopyThis = () => onCopy(social.field, `https://${social.prefix}${handle}`)
          return (
            <Grid key={social.field} size={{ xs: 12, sm: 6 }}>
              {editing
                ? <SocialEditField social={social} handle={handle} copied={copied} onChange={onChange} onCopy={onCopyThis} />
                : <SocialView social={social} handle={handle} copied={copied} onCopy={onCopyThis} />}
            </Grid>
          )
        })}
      </Grid>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Button
          size="small"
          startIcon={editing ? <CheckIcon /> : <EditIcon />}
          onClick={onToggleEditing}
          variant={editing ? 'contained' : 'outlined'}
        >
          {editing ? t($ => $.actions.done) : t($ => $.actions.edit)}
        </Button>
      </Box>
    </Box>
  )
}
