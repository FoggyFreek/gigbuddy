import PropTypes from 'prop-types'
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
import { SOCIALS } from './profileForm.js'

function CopyButton({ copied, label, onCopy, small }) {
  const iconSx = small ? { fontSize: 14 } : undefined
  const fontSize = small ? undefined : 'small'
  return (
    <Tooltip title={copied ? 'Copied' : 'Copy URL'}>
      <IconButton
        size="small"
        onClick={onCopy}
        sx={small ? { color: 'inherit', p: 0.25 } : undefined}
        aria-label={`Copy ${label} URL`}
      >
        {copied
          ? <CheckIcon sx={iconSx} fontSize={fontSize} />
          : <ContentCopyIcon sx={iconSx} fontSize={fontSize} />}
      </IconButton>
    </Tooltip>
  )
}

CopyButton.propTypes = {
  copied: PropTypes.bool,
  label: PropTypes.string.isRequired,
  onCopy: PropTypes.func.isRequired,
  small: PropTypes.bool,
}

function SocialView({ social, handle, copied, onCopy }) {
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

SocialView.propTypes = {
  social: PropTypes.object.isRequired,
  handle: PropTypes.string,
  copied: PropTypes.bool,
  onCopy: PropTypes.func.isRequired,
}

function SocialEditField({ social, handle, copied, onChange, onCopy }) {
  const { Icon } = social
  return (
    <TextField
      label={social.label}
      fullWidth
      value={handle}
      onChange={(e) => onChange(social.field, e.target.value)}
      placeholder="yourhandle"
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <Box sx={{ display: 'grid', placeItems: 'center' }}>
              <Icon fontSize="small" />
            </Box>
          </InputAdornment>
        ),
      }}
      FormHelperTextProps={{ component: 'div' }}
      helperText={(
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
          <span>{social.prefix + (handle || '…')}</span>
          {handle && <CopyButton copied={copied} label={social.label} onCopy={onCopy} small />}
        </Box>
      )}
    />
  )
}

SocialEditField.propTypes = {
  social: PropTypes.object.isRequired,
  handle: PropTypes.string,
  copied: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
  onCopy: PropTypes.func.isRequired,
}

export default function ProfileSocialsTab({ form, editing, onToggleEditing, onChange, copiedField, onCopy }) {
  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Button
          size="small"
          startIcon={editing ? <CheckIcon /> : <EditIcon />}
          onClick={onToggleEditing}
          variant={editing ? 'contained' : 'outlined'}
        >
          {editing ? 'Done' : 'Edit'}
        </Button>
      </Box>

      <Grid container spacing={2}>
        {SOCIALS.map((social) => {
          const handle = form[social.field]
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
    </Box>
  )
}

ProfileSocialsTab.propTypes = {
  form: PropTypes.object.isRequired,
  editing: PropTypes.bool,
  onToggleEditing: PropTypes.func.isRequired,
  onChange: PropTypes.func.isRequired,
  copiedField: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
}
