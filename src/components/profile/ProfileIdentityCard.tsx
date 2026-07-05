import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'
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
import DiamondOutlined from '@mui/icons-material/DiamondOutlined'
import EditIcon from '@mui/icons-material/Edit'
import PersonIcon from '@mui/icons-material/Person'
import { useThemeMode } from '../../contexts/themeModeContext.ts'
import { useEntitlements } from '../../hooks/useEntitlements.ts'

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
  // Plan lacks customization: render a diamond linking to the upsell page
  // instead of the camera uploader (same overlay slot and styling).
  locked?: boolean
  sx?: object
  iconSize?: number
}

const CAMERA_BUTTON_SX = {
  bgcolor: 'rgba(0,0,0,0.5)',
  color: '#fff',
  width: 28,
  height: 28,
  '&:hover': { bgcolor: 'rgba(0,0,0,0.72)' },
  '&.Mui-disabled': { bgcolor: 'rgba(0,0,0,0.3)', color: 'rgba(255,255,255,0.5)' },
} as const

function CameraButton({ onClick, disabled, tooltipTitle, locked, sx, iconSize = 16 }: Readonly<CameraButtonProps>) {
  const { t } = useTranslation('common')

  if (locked) {
    return (
      <Tooltip title={t($ => $.premium.tooltip)}>
        <IconButton
          component={RouterLink}
          to="/upgrade/customization"
          size="small"
          aria-label={t($ => $.premium.tooltip)}
          sx={{ ...CAMERA_BUTTON_SX, ...sx }}
        >
          <DiamondOutlined sx={{ fontSize: iconSize }} />
        </IconButton>
      </Tooltip>
    )
  }

  return (
    <Tooltip title={tooltipTitle}>
      <span>
        <IconButton
          size="small"
          onClick={onClick}
          disabled={disabled}
          sx={{ ...CAMERA_BUTTON_SX, ...sx }}
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

function UploadOverlay({ show, borderRadius = '0' }: Readonly<UploadOverlayProps>) {
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
}: Readonly<ProfileIdentityCardProps>) {
  const { t } = useTranslation(['profile', 'common'])
  const { mode } = useThemeMode()
  const { has } = useEntitlements()
  const [logoMenuAnchor, setLogoMenuAnchor] = useState<HTMLElement | null>(null)

  // Banner/logo/avatar uploads are part of the customization feature; without
  // it the camera buttons become diamond links to the upgrade page.
  const customizationLocked = !has('customization')

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
            alt={t($ => $.identity.bannerAlt)}
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
            tooltipTitle={t($ => $.identity.changeBanner)}
            onClick={banner.onUploadClick}
            disabled={banner.uploading}
            locked={customizationLocked}
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
            alt={t($ => $.identity.logoAlt)}
            sx={{ maxWidth: 140, maxHeight: 80, objectFit: 'contain', display: 'block' }}
            onError={(e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.src = '/share/logo.png' }}
          />
          <UploadOverlay show={logoUploading} borderRadius="4px" />
          {isAdmin && editing && (logo.onUploadClick || logoDark.onUploadClick) && (
            <CameraButton
              tooltipTitle={t($ => $.identity.changeLogo)}
              onClick={(e) => setLogoMenuAnchor(e.currentTarget)}
              disabled={logoUploading}
              locked={customizationLocked}
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
                alt={t($ => $.identity.avatarAlt)}
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
              tooltipTitle={t($ => $.identity.changeAvatar)}
              onClick={avatar.onUploadClick}
              disabled={avatar.uploading}
              locked={customizationLocked}
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
              alt={t($ => $.identity.logoAlt)}
              sx={{ maxWidth: 140, maxHeight: 80, objectFit: 'contain', display: 'block' }}
              onError={(e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.src = '/share/logo.png' }}
            />
            <UploadOverlay show={logoUploading} borderRadius="4px" />
            {isAdmin && editing && (logo.onUploadClick || logoDark.onUploadClick) && (
              <CameraButton
                tooltipTitle={t($ => $.identity.changeLogo)}
                onClick={(e) => setLogoMenuAnchor(e.currentTarget)}
                disabled={logoUploading}
                locked={customizationLocked}
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
            {editing ? t($ => $.actions.done, { ns: 'common' }) : t($ => $.actions.edit, { ns: 'common' })}
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
          {t($ => $.identity.lightLogo)}
        </MenuItem>
        <MenuItem onClick={() => { setLogoMenuAnchor(null); logoDark.onUploadClick?.() }}>
          {t($ => $.identity.darkLogo)}
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
                  alt={t($ => $.identity.avatarAlt)}
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
                tooltipTitle={t($ => $.identity.changeAvatar)}
                onClick={avatar.onUploadClick}
                disabled={avatar.uploading}
                locked={customizationLocked}
                sx={{ position: 'absolute', bottom: 6, right: 6 }}
              />
            )}
          </Box>

          {/* Band name */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {editing ? (
              <TextField
                label={t($ => $.identity.bandName)}
                fullWidth
                value={form.band_name}
                onChange={(e) => onChange('band_name', e.target.value)}
              />
            ) : (
              <Box>
                <Typography variant="caption" color="text.secondary">{t($ => $.identity.bandName)}</Typography>
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
              {editing ? t($ => $.actions.done, { ns: 'common' }) : t($ => $.actions.edit, { ns: 'common' })}
            </Button>
          </Box>

        </Box>

        {/* Bio — full width */}
        {editing ? (
          <TextField
            label={t($ => $.identity.bio)}
            fullWidth
            multiline
            minRows={4}
            value={form.bio}
            onChange={(e) => onChange('bio', e.target.value)}
          />
        ) : (
          <Box>
            <Typography variant="caption" color="text.secondary">{t($ => $.identity.bio)}</Typography>
            <Typography sx={{ whiteSpace: 'pre-wrap' }}>{form.bio || '—'}</Typography>
          </Box>
        )}

      </Stack>
    </Paper>
  )
}
