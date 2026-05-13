import { useCallback, useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import Snackbar from '@mui/material/Snackbar'
import { alpha } from '@mui/material/styles'
import AddIcon from '@mui/icons-material/Add'
import CheckIcon from '@mui/icons-material/Check'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import FacebookIcon from '@mui/icons-material/Facebook'
import InstagramIcon from '@mui/icons-material/Instagram'
import LaunchIcon from '@mui/icons-material/Launch'
import LinkIcon from '@mui/icons-material/Link'
import YouTubeIcon from '@mui/icons-material/YouTube'
import SpotifyIcon from '../components/icons/SpotifyIcon.jsx'
import TikTokIcon from '../components/icons/TikTokIcon.jsx'
import useDebouncedSave from '../hooks/useDebouncedSave.js'
import { useAuth } from '../contexts/authContext.js'
import { useProfile } from '../contexts/profileContext.js'
import BandMembersSection from '../components/BandMembersSection.jsx'
import ImageCropDialog from '../components/ImageCropDialog.jsx'
import {
  createLink,
  deleteLink,
  getProfile,
  updateLink,
  updateProfile,
  uploadLogo,
} from '../api/profile.js'
import { compressLogo } from '../utils/compressImage.js'

const SOCIALS = [
  { field: 'instagram_handle', label: 'Instagram', Icon: InstagramIcon, prefix: 'instagram.com/' },
  { field: 'facebook_handle',  label: 'Facebook',  Icon: FacebookIcon,  prefix: 'facebook.com/' },
  { field: 'tiktok_handle',    label: 'TikTok',    Icon: TikTokIcon,    prefix: 'tiktok.com/@' },
  { field: 'youtube_handle',   label: 'YouTube',   Icon: YouTubeIcon,   prefix: 'youtube.com/@' },
  { field: 'spotify_handle',   label: 'Spotify',   Icon: SpotifyIcon,   prefix: 'open.spotify.com/artist/' },
]

const EMPTY_FORM = {
  band_name: '',
  bio: '',
  instagram_handle: '',
  facebook_handle: '',
  tiktok_handle: '',
  youtube_handle: '',
  spotify_handle: '',
}

export default function ProfilePage() {
  const { user } = useAuth()
  const isAdmin = user?.isSuperAdmin || user?.activeTenantRole === 'tenant_admin'

  const [form, setForm] = useState(EMPTY_FORM)
  const [logoPath, setLogoPath] = useState(null)
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoCropOpen, setLogoCropOpen] = useState(false)
  const [logoCropSrc, setLogoCropSrc] = useState(null)
  const [links, setLinks] = useState([])
  const [loading, setLoading] = useState(true)
  const [newLink, setNewLink] = useState({ label: '', url: '' })
  const [adding, setAdding] = useState(false)
  const [copiedField, setCopiedField] = useState(null)
  const [editingIdentity, setEditingIdentity] = useState(false)
  const [editingSocials, setEditingSocials] = useState(false)
  const [snackbar, setSnackbar] = useState(null)
  const logoInputRef = useRef(null)
  const { setBandName } = useProfile()

  function handleCopy(field, text) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field)
      setTimeout(() => setCopiedField((c) => (c === field ? null : c)), 1500)
    }).catch(() => {})
  }

  const saveFn = useCallback(async (patch) => { await updateProfile(patch) }, [])
  const { schedule, status: saveStatus } = useDebouncedSave(saveFn)

  useEffect(() => {
    getProfile()
      .then((data) => {
        setForm({
          band_name: data.band_name || '',
          bio: data.bio || '',
          instagram_handle: data.instagram_handle || '',
          facebook_handle: data.facebook_handle || '',
          tiktok_handle: data.tiktok_handle || '',
          youtube_handle: data.youtube_handle || '',
          spotify_handle: data.spotify_handle || '',
        })
        setLogoPath(data.logo_path || null)
        setLinks(data.links || [])
      })
      .finally(() => setLoading(false))
  }, [])

  function handleLogoFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    if (file.type === 'image/gif') {
      setSnackbar('File type not allowed')
      return
    }
    const url = URL.createObjectURL(file)
    setLogoCropSrc(url)
    setLogoCropOpen(true)
  }

  async function handleLogoCropConfirm(blob) {
    setLogoCropOpen(false)
    if (logoCropSrc) URL.revokeObjectURL(logoCropSrc)
    setLogoCropSrc(null)
    setLogoUploading(true)
    try {
      const compressed = await compressLogo(blob)
      const { logo_path } = await uploadLogo(compressed)
      setLogoPath(logo_path)
    } catch (err) {
      setSnackbar(err.message || 'Upload failed')
    } finally {
      setLogoUploading(false)
    }
  }

  function handleLogoCropCancel() {
    setLogoCropOpen(false)
    if (logoCropSrc) URL.revokeObjectURL(logoCropSrc)
    setLogoCropSrc(null)
  }

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
    if (field === 'band_name') setBandName(value)
    schedule({ [field]: value })
  }

  async function handleAddLink() {
    if (!newLink.label.trim() || !newLink.url.trim() || adding) return
    setAdding(true)
    try {
      const created = await createLink({ label: newLink.label.trim(), url: newLink.url.trim() })
      setLinks((prev) => [...prev, created])
      setNewLink({ label: '', url: '' })
    } finally {
      setAdding(false)
    }
  }

  async function handleDeleteLink(id) {
    await deleteLink(id)
    setLinks((prev) => prev.filter((l) => l.id !== id))
  }

  function handleLinkChange(id, patch) {
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }

  const saveLabel = {
    idle: '',
    saving: 'Saving…',
    saved: 'Saved',
    error: 'Save failed',
  }[saveStatus]
  const saveColor = saveStatus === 'error' ? 'error.main' : 'text.secondary'

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={600} sx={{ flexGrow: 1 }}>Profile</Typography>
        <Typography variant="caption" color={saveColor}>{saveLabel}</Typography>
      </Box>

      <Grid container spacing={3} sx={{ mb: 3, alignItems: 'flex-start' }}>
      <Grid size={{ xs: 12, lg: 8 }}>
      <Paper variant="outlined" sx={{ p: 3, height: '100%' }}>
        {/* Banner: accent strip with centered logo */}
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
                    onChange={handleLogoFileChange}
                  />
                  <ButtonBase
                    onClick={() => logoInputRef.current?.click()}
                    disabled={logoUploading}
                    sx={{ borderRadius: 1, overflow: 'hidden', cursor: 'pointer' }}
                  >
                    <Box
                      component="img"
                      src={logoPath ? `/api/files/${logoPath}` : '/share/logo.png'}
                      alt="Band logo"
                      sx={{ maxWidth: 200, maxHeight: 120, objectFit: 'contain', display: 'block' }}
                      onError={(e) => { e.currentTarget.src = '/share/logo.png' }}
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
                  src={logoPath ? `/api/files/${logoPath}` : '/share/logo.png'}
                  alt="Band logo"
                  sx={{ maxWidth: 200, maxHeight: 120, objectFit: 'contain', display: 'block' }}
                  onError={(e) => { e.currentTarget.src = '/share/logo.png' }}
                />
              )}
            </Box>
          </Tooltip>
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
          <Button
            size="small"
            startIcon={editingIdentity ? <CheckIcon /> : <EditIcon />}
            onClick={() => setEditingIdentity((v) => !v)}
            variant={editingIdentity ? 'contained' : 'outlined'}
          >
            {editingIdentity ? 'Done' : 'Edit'}
          </Button>
        </Box>

        {editingIdentity ? (
          <Grid container spacing={2}>
            <Grid size={12}>
              <TextField
                label="Band name"
                fullWidth
                value={form.band_name}
                onChange={(e) => handleChange('band_name', e.target.value)}
              />
            </Grid>
            <Grid size={12}>
              <TextField
                label="Bio"
                fullWidth
                multiline
                minRows={4}
                value={form.bio}
                onChange={(e) => handleChange('bio', e.target.value)}
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
      </Grid>

      <Grid size={{ xs: 12, lg: 4 }}>
        <BandMembersSection />
      </Grid>
      </Grid>

      <Grid container spacing={3} sx={{ mb: 3, alignItems: 'flex-start' }}>
      <Grid size={{ xs: 12, lg: 6 }}>
      <Paper variant="outlined" sx={{ p: 3, height: '100%' }}>
        <Stack direction="row" sx={{ mb: 2, alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="subtitle1" fontWeight={600}>
            Social profiles
          </Typography>
          <Button
            size="small"
            startIcon={editingSocials ? <CheckIcon /> : <EditIcon />}
            onClick={() => setEditingSocials((v) => !v)}
            variant={editingSocials ? 'contained' : 'outlined'}
            sx={{ ml: 2 }}
          >
            {editingSocials ? 'Done' : 'Edit'}
          </Button>
        </Stack>

        <Grid container spacing={2}>
          {SOCIALS.map((social) => {
            const Icon = social.Icon
            const handle = form[social.field]
            const fullUrl = `https://${social.prefix}${handle}`

            if (!editingSocials) {
              return (
                <Grid key={social.field} size={{ xs: 12, sm: 6 }}>
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
                    {handle && (
                      <Tooltip title={copiedField === social.field ? 'Copied' : 'Copy URL'}>
                        <IconButton
                          size="small"
                          onClick={() => handleCopy(social.field, fullUrl)}
                          aria-label={`Copy ${social.label} URL`}
                        >
                          {copiedField === social.field
                            ? <CheckIcon fontSize="small" />
                            : <ContentCopyIcon fontSize="small" />}
                        </IconButton>
                      </Tooltip>
                    )}
                  </Stack>
                </Grid>
              )
            }

            return (
              <Grid key={social.field} size={{ xs: 12, sm: 6 }}>
                <TextField
                  label={social.label}
                  fullWidth
                  value={handle}
                  onChange={(e) => handleChange(social.field, e.target.value)}
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
                      {handle && (
                        <Tooltip title={copiedField === social.field ? 'Copied' : 'Copy URL'}>
                          <IconButton
                            size="small"
                            onClick={() => handleCopy(social.field, fullUrl)}
                            sx={{ color: 'inherit', p: 0.25 }}
                            aria-label={`Copy ${social.label} URL`}
                          >
                            {copiedField === social.field
                              ? <CheckIcon sx={{ fontSize: 14 }} />
                              : <ContentCopyIcon sx={{ fontSize: 14 }} />}
                          </IconButton>
                        </Tooltip>
                      )}
                    </Box>
                  )}
                />
              </Grid>
            )
          })}
        </Grid>
      </Paper>
      </Grid>

      <Grid size={{ xs: 12, lg: 6 }}>
      <Paper variant="outlined" sx={{ p: 3, height: '100%' }}>
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
          Links
        </Typography>

        <Stack spacing={2}>
          {links.map((link) => (
            <ProfileLinkRow
              key={link.id}
              link={link}
              onChange={(patch) => handleLinkChange(link.id, patch)}
              onDelete={() => handleDeleteLink(link.id)}
            />
          ))}

          {links.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              No links yet. Add one below — e.g. a Google Drive folder with your EPK.
            </Typography>
          )}

          <Divider />

          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
            <TextField
              label="Label"
              size="small"
              value={newLink.label}
              onChange={(e) => setNewLink((p) => ({ ...p, label: e.target.value }))}
              sx={{ flex: 1 }}
            />
            <TextField
              label="URL"
              size="small"
              value={newLink.url}
              onChange={(e) => setNewLink((p) => ({ ...p, url: e.target.value }))}
              sx={{ flex: 2 }}
              placeholder="https://…"
            />
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={handleAddLink}
              disabled={!newLink.label.trim() || !newLink.url.trim() || adding}
              sx={{ height: 40, whiteSpace: 'nowrap' }}
            >
              Add link
            </Button>
          </Stack>
        </Stack>
      </Paper>
      </Grid>
      </Grid>

      <Snackbar
        open={!!snackbar}
        autoHideDuration={4000}
        onClose={() => setSnackbar(null)}
        message={snackbar}
      />

      <ImageCropDialog
        open={logoCropOpen}
        imageSrc={logoCropSrc}
        title="Crop band logo"
        onConfirm={handleLogoCropConfirm}
        onCancel={handleLogoCropCancel}
      />
    </Box>
  )
}

function ProfileLinkRow({ link, onChange, onDelete }) {
  const [editing, setEditing] = useState(false)
  const saveFn = useCallback(
    async (patch) => { await updateLink(link.id, patch) },
    [link.id]
  )
  const { schedule } = useDebouncedSave(saveFn)

  function handle(field, value) {
    onChange({ [field]: value })
    schedule({ [field]: value })
  }

  if (!editing) {
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Box sx={{ display: 'grid', placeItems: 'center' }}>
          <LinkIcon color="action" />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={500}>{link.label || '—'}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
            {link.url || '—'}
          </Typography>
        </Box>
        <Tooltip title="Open in new tab">
            <IconButton
              component="a"
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              disabled={!link.url}
              size="small"
            >
              <Box sx={{ display: 'grid', placeItems: 'center' }}>
                <LaunchIcon fontSize="small" />
              </Box>
            </IconButton>
        </Tooltip>
        <Tooltip title="Edit link">
          <IconButton size="small" onClick={() => setEditing(true)}>
            <EditIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete link">
          <IconButton onClick={onDelete} color="error" size="small">
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    )
  }

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Box sx={{ display: 'grid', placeItems: 'center' }}>
        <LinkIcon color="action" />
      </Box>
      <TextField
        label="Label"
        size="small"
        value={link.label}
        onChange={(e) => handle('label', e.target.value)}
        sx={{ flex: 1 }}
      />
      <TextField
        label="URL"
        size="small"
        value={link.url}
        onChange={(e) => handle('url', e.target.value)}
        sx={{ flex: 2 }}
      />
      <Tooltip title="Open in new tab">
        <span>
          <IconButton
            component="a"
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            disabled={!link.url}
            size="small"
          >
            <Box sx={{ display: 'grid', placeItems: 'center' }}>
              <LaunchIcon fontSize="small" />
            </Box>
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Done editing">
        <IconButton size="small" onClick={() => setEditing(false)} color="primary">
          <CheckIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="Delete link">
        <IconButton onClick={onDelete} color="error" size="small">
          <DeleteIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Stack>
  )
}
