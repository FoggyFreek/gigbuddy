import { useState } from 'react'
import type { ProfileForm } from './profileForm.ts'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import Stack from '@mui/material/Stack'
import { alpha } from '@mui/material/styles'
import CameraAltIcon from '@mui/icons-material/CameraAlt'
import CheckIcon from '@mui/icons-material/Check'
import EditIcon from '@mui/icons-material/Edit'
import PersonIcon from '@mui/icons-material/Person'
import { useThemeMode } from '../../contexts/themeModeContext.ts'

// 820×360 stored; display 820×312 desktop, 640×360 compact
const BANNER_ASPECT_DESKTOP = (312 / 820) * 100  // 38.05%
const BANNER_ASPECT_COMPACT = (360 / 640) * 100  // 56.25%

const AVATAR_SIZE = 166
const AVATAR_SIZE_COMPACT = 80
const AVATAR_OVERLAP = Math.round(AVATAR_SIZE / 2)        // 83px
const AVATAR_OVERLAP_COMPACT = Math.round(AVATAR_SIZE_COMPACT / 2)  // 45px

interface ImageSlot {
  path: string | null
  uploading: boolean
  onUploadClick?: () => void
}

interface ProfileIdentityCardProps {
  form: ProfileForm
  isAdmin?: boolean
  editing?: boolean
  onToggleEditing: () => void
  onChange: (field: keyof ProfileForm, value: string) => void
  logo: ImageSlot
  logoDark: ImageSlot
  banner: ImageSlot
  avatar: ImageSlot
}

function logoSrc(path: string | null | undefined): string {
  return path ? `/api/files/${path}` : '/share/logo.png'
}

interface CameraButtonProps {
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  tooltipTitle: string
  sx?: object
  iconSize?: number
}

function CameraButton({ onClick, disabled, tooltipTitle, sx, iconSize = 16 }: CameraButtonProps) {
  return (
    <Tooltip title={tooltipTitle}>
      <span>
        <IconButton
          size="small"
          onClick={onClick}
          disabled={disabled}
          sx={{
            bgcolor: 'rgba(0,0,0,0.5)',
            color: '#fff',
            width: 28,
            height: 28,
            '&:hover': { bgcolor: 'rgba(0,0,0,0.72)' },
            '&.Mui-disabled': { bgcolor: 'rgba(0,0,0,0.3)', color: 'rgba(255,255,255,0.5)' },
            ...sx,
          }}
        >
          <CameraAltIcon sx={{ fontSize: iconSize }} />
        </IconButton>
      </span>
    </Tooltip>
  )
}

interface UploadOverlayProps {
  show: boolean
  borderRadius?: string
}

function UploadOverlay({ show, borderRadius = '0' }: UploadOverlayProps) {
  if (!show) return null
  return (
    <Box sx={{
      position: 'absolute', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      bgcolor: 'rgba(0,0,0,0.4)',
      borderRadius,
    }}>
      <CircularProgress size={28} sx={{ color: '#fff' }} />
    </Box>
  )
}

export default function ProfileIdentityCard({
  form, isAdmin, editing, onToggleEditing, onChange,
  logo, logoDark, banner, avatar,
}: ProfileIdentityCardProps) {
  const { mode } = useThemeMode()
  const [logoMenuAnchor, setLogoMenuAnchor] = useState<HTMLElement | null>(null)

  // Theme-aware logo: dark variant in dark mode when available, else light logo
  const displayLogoPath = mode === 'dark' && logoDark.path ? logoDark.path : logo.path
  const logoUploading = logo.uploading || logoDark.uploading

  return (
    <Paper variant="outlined" sx={{ p: 3, height: '100%' }}>

      {/* ── Banner ──────────────────────────────────────────────────────── */}
      <Box sx={(theme) => ({
        mx: -3, mt: -3,
        position: 'relative',
        paddingTop: { xs: `${BANNER_ASPECT_COMPACT}%`, md: `${BANNER_ASPECT_DESKTOP}%` },
        overflow: 'hidden',
        borderRadius: `${theme.shape.borderRadius}px ${theme.shape.borderRadius}px 0 0`,
      })}>
        {banner.path ? (
          <Box
            component="img"
            src={`/api/files/${banner.path}`}
            alt="Profile banner"
            sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <Box sx={(theme) => ({
            position: 'absolute', inset: 0,
            background: theme.palette.mode === 'dark'
              ? `linear-gradient(160deg, ${alpha(theme.palette.primary.dark, 0.55)}, ${alpha(theme.palette.primary.main, 0.35)})`
              : `linear-gradient(160deg, ${alpha(theme.palette.primary.dark, 0.82)}, ${alpha(theme.palette.primary.main, 0.65)})`,
          })} />
        )}
        <UploadOverlay show={banner.uploading} />
        {isAdmin && editing && banner.onUploadClick && (
          <CameraButton
            tooltipTitle="Change banner"
            onClick={banner.onUploadClick}
            disabled={banner.uploading}
            sx={{ position: 'absolute', top: 8, right: 8 }}
            iconSize={18}
          />
        )}
      </Box>

      {/* ── Logo below banner (compact only) ───────────────────────────── */}
      <Box sx={{ display: { xs: 'flex', md: 'none' }, justifyContent: 'center', pt: 1, pb: 1 }}>
        <Box sx={{ position: 'relative', display: 'inline-flex' }}>
          <Box
            component="img"
            src={logoSrc(displayLogoPath)}
            alt="Band logo"
            sx={{ maxWidth: 140, maxHeight: 80, objectFit: 'contain', display: 'block' }}
            onError={(e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.src = '/share/logo.png' }}
          />
          <UploadOverlay show={logoUploading} borderRadius="4px" />
          {isAdmin && editing && (logo.onUploadClick || logoDark.onUploadClick) && (
            <CameraButton
              tooltipTitle="Change logo"
              onClick={(e) => setLogoMenuAnchor(e.currentTarget)}
              disabled={logoUploading}
              sx={{ position: 'absolute', top: -10, right: -10 }}
            />
          )}
        </Box>
      </Box>

      {/* ── Avatar | Logo | Edit row (desktop only) ──────────────────────── */}
      <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'flex-end', mt: `-${AVATAR_OVERLAP}px`, mb: 2, position: 'relative', zIndex: 1 }}>

        {/* Avatar — left (desktop only) */}
        <Box sx={{ flexShrink: 0, position: 'relative', display: { xs: 'none', md: 'flex' } }}>
          <Box sx={{
            width: AVATAR_SIZE,
            height: AVATAR_SIZE,
            borderRadius: '50%',
            overflow: 'hidden',
            border: '3px solid',
            borderColor: 'background.paper',
            bgcolor: 'action.hover',
            flexShrink: 0,
          }}>
            {avatar.path ? (
              <Box
                component="img"
                src={`/api/files/${avatar.path}`}
                alt="Profile picture"
                sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                onError={(e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = 'none' }}
              />
            ) : (
              <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <PersonIcon sx={{ fontSize: 68, color: 'text.disabled' }} />
              </Box>
            )}
          </Box>
          <UploadOverlay show={avatar.uploading} borderRadius="50%" />
          {isAdmin && editing && avatar.onUploadClick && (
            <CameraButton
              tooltipTitle="Change profile picture"
              onClick={avatar.onUploadClick}
              disabled={avatar.uploading}
              sx={{ position: 'absolute', bottom: 6, right: 6 }}
            />
          )}
        </Box>

        {/* Logo — centered over full row width (desktop only) */}
        <Box sx={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 4, display: { xs: 'none', md: 'block' } }}>
          <Box sx={{ position: 'relative', display: 'inline-flex' }}>
            <Box
              component="img"
              src={logoSrc(displayLogoPath)}
              alt="Band logo"
              sx={{ maxWidth: 140, maxHeight: 80, objectFit: 'contain', display: 'block' }}
              onError={(e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.src = '/share/logo.png' }}
            />
            <UploadOverlay show={logoUploading} borderRadius="4px" />
            {isAdmin && editing && (logo.onUploadClick || logoDark.onUploadClick) && (
              <CameraButton
                tooltipTitle="Change logo"
                onClick={(e) => setLogoMenuAnchor(e.currentTarget)}
                disabled={logoUploading}
                sx={{ position: 'absolute', top: -10, right: -10 }}
              />
            )}
          </Box>
        </Box>

        <Box sx={{ flex: 1 }} />

        {/* Edit button — right */}
        <Box sx={{ flexShrink: 0, pb: 2 }}>
          <Button
            size="small"
            startIcon={editing ? <CheckIcon /> : <EditIcon />}
            onClick={onToggleEditing}
            variant={editing ? 'contained' : 'outlined'}
          >
            {editing ? 'Done' : 'Edit'}
          </Button>
        </Box>
      </Box>

      {/* Logo upload menu — shared by compact and desktop logo camera buttons */}
      <Menu
        anchorEl={logoMenuAnchor}
        open={Boolean(logoMenuAnchor)}
        onClose={() => setLogoMenuAnchor(null)}
      >
        <MenuItem onClick={() => { setLogoMenuAnchor(null); logo.onUploadClick?.() }}>
          Light theme logo
        </MenuItem>
        <MenuItem onClick={() => { setLogoMenuAnchor(null); logoDark.onUploadClick?.() }}>
          Dark theme logo
        </MenuItem>
      </Menu>

      {/* ── Band name + bio ─────────────────────────────────────────────── */}
      <Stack spacing={2}>

        {/* Band name row: compact avatar (xs only) + band name */}
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>

          {/* Profile picture next to band name (compact only) */}
          <Box sx={{ display: { xs: 'block', md: 'none' }, flexShrink: 0, position: 'relative' }}>
            <Box sx={{
              width: AVATAR_SIZE_COMPACT,
              height: AVATAR_SIZE_COMPACT,
              borderRadius: '50%',
              overflow: 'hidden',
              border: '3px solid',
              borderColor: 'background.paper',
              bgcolor: 'action.hover',
            }}>
              {avatar.path ? (
                <Box
                  component="img"
                  src={`/api/files/${avatar.path}`}
                  alt="Profile picture"
                  sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  onError={(e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = 'none' }}
                />
              ) : (
                <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <PersonIcon sx={{ fontSize: 36, color: 'text.disabled' }} />
                </Box>
              )}
            </Box>
            <UploadOverlay show={avatar.uploading} borderRadius="50%" />
            {isAdmin && editing && avatar.onUploadClick && (
              <CameraButton
                tooltipTitle="Change profile picture"
                onClick={avatar.onUploadClick}
                disabled={avatar.uploading}
                sx={{ position: 'absolute', bottom: 6, right: 6 }}
              />
            )}
          </Box>

          {/* Band name */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {editing ? (
              <TextField
                label="Band name"
                fullWidth
                value={form.band_name}
                onChange={(e) => onChange('band_name', e.target.value)}
              />
            ) : (
              <Box>
                <Typography variant="caption" color="text.secondary">Band name</Typography>
                <Typography>{form.band_name || '—'}</Typography>
              </Box>
            )}
          </Box>

          {/* Edit button — compact only */}
          <Box sx={{ display: { xs: 'block', md: 'none' }, flexShrink: 0 }}>
            <Button
              size="small"
              startIcon={editing ? <CheckIcon /> : <EditIcon />}
              onClick={onToggleEditing}
              variant={editing ? 'contained' : 'outlined'}
            >
              {editing ? 'Done' : 'Edit'}
            </Button>
          </Box>

        </Box>

        {/* Bio — full width */}
        {editing ? (
          <TextField
            label="Bio"
            fullWidth
            multiline
            minRows={4}
            value={form.bio}
            onChange={(e) => onChange('bio', e.target.value)}
          />
        ) : (
          <Box>
            <Typography variant="caption" color="text.secondary">Bio</Typography>
            <Typography sx={{ whiteSpace: 'pre-wrap' }}>{form.bio || '—'}</Typography>
          </Box>
        )}

      </Stack>
    </Paper>
  )
}
