import type { RefObject } from 'react'
import type { ProfileForm } from './profileForm.ts'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import CircularProgress from '@mui/material/CircularProgress'
import Grid from '@mui/material/Grid'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { alpha } from '@mui/material/styles'
import CheckIcon from '@mui/icons-material/Check'
import EditIcon from '@mui/icons-material/Edit'

const LOGO_IMG_SX = { maxWidth: 200, maxHeight: 120, objectFit: 'contain', display: 'block' }

function logoSrc(logoPath?: string): string {
  return logoPath ? `/api/files/${logoPath}` : '/share/logo.png'
}

interface ProfileIdentityCardProps {
  form: ProfileForm
  isAdmin?: boolean
  editing?: boolean
  onToggleEditing: () => void
  onChange: (field: keyof ProfileForm, value: string) => void
  logoPath?: string
  logoUploading?: boolean
  logoInputRef: RefObject<HTMLInputElement | null>
  onLogoFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}

export default function ProfileIdentityCard({
  form, isAdmin, editing, onToggleEditing, onChange,
  logoPath, logoUploading, logoInputRef, onLogoFileChange,
}: ProfileIdentityCardProps) {
  return (
    <Paper variant="outlined" sx={{ p: 3, height: '100%' }}>
      <Box sx={(theme) => ({
        mx: -3,
        mt: -3,
        mb: 3,
        py: 3,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        background: theme.palette.mode === 'dark'
          ? `linear-gradient(160deg, ${alpha(theme.palette.primary.dark, 0.55)}, ${alpha(theme.palette.primary.main, 0.35)})`
          : `linear-gradient(160deg, ${alpha(theme.palette.primary.dark, 0.82)}, ${alpha(theme.palette.primary.main, 0.65)})`,
        boxShadow: '0 3px 10px rgba(0,0,0,0.22)',
        borderRadius: `${theme.shape.borderRadius}px ${theme.shape.borderRadius}px 0 0`,
      })}>
        <Tooltip title={isAdmin ? 'Click to change logo' : ''} disableHoverListener={!isAdmin}>
          <Box sx={{ position: 'relative', display: 'inline-flex' }}>
            {isAdmin ? (
              <>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  style={{ display: 'none' }}
                  onChange={onLogoFileChange}
                />
                <ButtonBase
                  onClick={() => logoInputRef.current?.click()}
                  disabled={logoUploading}
                  sx={{ borderRadius: 1, overflow: 'hidden', cursor: 'pointer' }}
                >
                  <Box
                    component="img"
                    src={logoSrc(logoPath)}
                    alt="Band logo"
                    sx={LOGO_IMG_SX}
                    onError={(e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.src = '/share/logo.png' }}
                  />
                </ButtonBase>
                {logoUploading && (
                  <Box sx={{
                    position: 'absolute', inset: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    bgcolor: 'rgba(0,0,0,0.4)', borderRadius: 1,
                  }}>
                    <CircularProgress size={28} />
                  </Box>
                )}
              </>
            ) : (
              <Box
                component="img"
                src={logoSrc(logoPath)}
                alt="Band logo"
                sx={LOGO_IMG_SX}
                onError={(e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.src = '/share/logo.png' }}
              />
            )}
          </Box>
        </Tooltip>
      </Box>

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

      {editing ? (
        <Grid container spacing={2}>
          <Grid size={12}>
            <TextField
              label="Band name"
              fullWidth
              value={form.band_name}
              onChange={(e) => onChange('band_name', e.target.value)}
            />
          </Grid>
          <Grid size={12}>
            <TextField
              label="Bio"
              fullWidth
              multiline
              minRows={4}
              value={form.bio}
              onChange={(e) => onChange('bio', e.target.value)}
            />
          </Grid>
        </Grid>
      ) : (
        <Stack spacing={2}>
          <Box>
            <Typography variant="caption" color="text.secondary">Band name</Typography>
            <Typography>{form.band_name || '—'}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Bio</Typography>
            <Typography sx={{ whiteSpace: 'pre-wrap' }}>{form.bio || '—'}</Typography>
          </Box>
        </Stack>
      )}
    </Paper>
  )
}
