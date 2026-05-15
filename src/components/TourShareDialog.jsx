import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControl from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Slider from '@mui/material/Slider'
import Switch from '@mui/material/Switch'
import Snackbar from '@mui/material/Snackbar'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteIcon from '@mui/icons-material/Delete'
import DownloadIcon from '@mui/icons-material/Download'
import TourShareCard from './share/TourShareCard.jsx'
import { AuthContext } from '../contexts/authContext.js'
import { getProfile } from '../api/profile.js'
import { getSharePhotos, uploadSharePhoto, deleteSharePhoto } from '../api/sharePhotos.js'
import {
  buildTourShareFilename,
  canCopyImageToClipboard,
  copyBlobToClipboard,
  downloadBlob,
  renderNodeToBlob,
  SHARE_FORMATS,
  SHARE_VINTAGE_COLORS,
} from '../utils/shareCard.js'
import { compressPhoto } from '../utils/compressImage.js'

const NOW = new Date()
const CURRENT_YEAR = NOW.getFullYear()
const CURRENT_MONTH = NOW.getMonth() // 0-indexed

function maxMonthsForYear(year) {
  if (year === CURRENT_YEAR) return 12 - CURRENT_MONTH
  if (year > CURRENT_YEAR) return 12
  return 0
}

export default function TourShareDialog({ open, onClose, gigs = [] }) {
  const { user } = useContext(AuthContext)
  const isAdmin = user?.isSuperAdmin || user?.activeTenantRole === 'tenant_admin'

  const [photos, setPhotos] = useState([])
  const [photoId, setPhotoId] = useState(null)
  const [photosLoading, setPhotosLoading] = useState(false)
  const [format, setFormat] = useState('square')
  const [accentId, setAccentId] = useState(SHARE_VINTAGE_COLORS[0].id)
  const [photoOpacity, setPhotoOpacity] = useState(35)
  const [zoom, setZoom] = useState(100)
  const [pan, setPan] = useState(0)
  const [showBanners, setShowBanners] = useState(false)
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR)
  const [monthsAhead, setMonthsAhead] = useState('all')
  const [includePast, setIncludePast] = useState(false)
  const [socials, setSocials] = useState({})
  const [logoSrc, setLogoSrc] = useState('/share/logo.png')
  const [busy, setBusy] = useState(false)
  const [snackbar, setSnackbar] = useState(null)
  const photoInputRef = useRef(null)
  const cardRef = useRef(null)

  const canCopy = useMemo(() => canCopyImageToClipboard(), [])
  const formatDef = SHARE_FORMATS[format]
  const selectedPhoto = photos.find((p) => p.id === photoId)
  const photoSrc = selectedPhoto ? `/api/files/${selectedPhoto.object_key}` : null
  const accentColor = SHARE_VINTAGE_COLORS.find((c) => c.id === accentId)?.value || SHARE_VINTAGE_COLORS[0].value

  const today = useMemo(() => NOW.toISOString().slice(0, 10), [])
  const maxMonths = maxMonthsForYear(selectedYear)

  async function loadPhotos() {
    setPhotosLoading(true)
    try {
      const rows = await getSharePhotos()
      setPhotos(rows)
      setPhotoId((prev) => {
        if (prev && rows.some((r) => r.id === prev)) return prev
        return rows[0]?.id ?? null
      })
    } catch {
      // non-fatal
    } finally {
      setPhotosLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      setFormat('square')
      setAccentId(SHARE_VINTAGE_COLORS[0].id)
      setPhotoOpacity(35)
      setZoom(100)
      setPan(0)
      setShowBanners(false)
      setSelectedYear(CURRENT_YEAR)
      setMonthsAhead('all')
      setIncludePast(false)
      setBusy(false)
      loadPhotos()
      getProfile().then((p) => {
        setSocials({
          instagram: p?.instagram_handle || '',
          facebook: p?.facebook_handle || '',
          tiktok: p?.tiktok_handle || '',
        })
        setLogoSrc(p?.logo_path ? `/api/files/${p.logo_path}` : '/share/logo.png')
      }).catch(() => {})
    }
  }, [open])

  function handleYearChange(_, v) {
    if (!v) return
    setSelectedYear(v)
    const newMax = maxMonthsForYear(v)
    if (monthsAhead !== 'all' && (newMax === 0 || Number(monthsAhead) > newMax)) {
      setMonthsAhead('all')
    }
  }

  const visibleGigs = useMemo(() => {
    let cutoff = null
    if (monthsAhead !== 'all') {
      const d = new Date(NOW)
      d.setMonth(d.getMonth() + Number(monthsAhead))
      cutoff = d.toISOString().slice(0, 10)
    }
    return gigs.filter((g) => {
      const gigDate = String(g.event_date).slice(0, 10)
      if (new Date(g.event_date).getFullYear() !== selectedYear) return false
      if (!includePast && gigDate < today) return false
      if (cutoff !== null && gigDate > cutoff) return false
      return true
    })
  }, [gigs, selectedYear, monthsAhead, includePast, today])

  const previewMaxWidth = 320
  const scale = previewMaxWidth / formatDef.width

  async function snapshot() {
    if (!cardRef.current) return null
    return renderNodeToBlob(cardRef.current, { width: formatDef.width, height: formatDef.height })
  }

  async function handleDownload() {
    setBusy(true)
    try {
      const blob = await snapshot()
      if (!blob) throw new Error('Snapshot failed')
      downloadBlob(blob, buildTourShareFilename(selectedYear, format))
    } catch (e) {
      setSnackbar({ msg: e.message || 'Download failed' })
    } finally {
      setBusy(false)
    }
  }

  async function handleCopy() {
    setBusy(true)
    try {
      const blob = await snapshot()
      if (!blob) throw new Error('Snapshot failed')
      await copyBlobToClipboard(blob)
      setSnackbar({ msg: 'Image copied to clipboard' })
    } catch (e) {
      setSnackbar({ msg: e.message || 'Copy failed' })
    } finally {
      setBusy(false)
    }
  }

  async function handlePhotoUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setBusy(true)
    try {
      const compressed = await compressPhoto(file)
      const newPhoto = await uploadSharePhoto(compressed)
      setPhotos((prev) => [...prev, newPhoto])
      setPhotoId(newPhoto.id)
    } catch (err) {
      setSnackbar({ msg: err.message || 'Upload failed' })
    } finally {
      setBusy(false)
    }
  }

  async function handlePhotoDelete(photo) {
    try {
      await deleteSharePhoto(photo.id)
      setPhotos((prev) => {
        const next = prev.filter((p) => p.id !== photo.id)
        setPhotoId((cur) => {
          if (cur !== photo.id) return cur
          return next[0]?.id ?? null
        })
        return next
      })
    } catch (err) {
      setSnackbar({ msg: err.message || 'Delete failed' })
    }
  }

  const monthsOptions = [
    { value: 'all', label: 'All' },
    ...Array.from({ length: maxMonths }, (_, i) => ({
      value: i + 1,
      label: `${i + 1} month${i + 1 > 1 ? 's' : ''}`,
    })),
  ]

  return (
    <>
      <Dialog
        open={open}
        onClose={busy ? undefined : onClose}
        maxWidth="md"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogTitle>Share tour dates</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ alignItems: 'center' }}>

            {/* Format */}
            <ToggleButtonGroup
              value={format}
              exclusive
              size="small"
              onChange={(_, v) => v && setFormat(v)}
            >
              <ToggleButton value="square">Square 1:1</ToggleButton>
              <ToggleButton value="story">Story 9:16</ToggleButton>
            </ToggleButtonGroup>

            {/* Accent colors */}
            <Stack direction="row" spacing={1.25}>
              {SHARE_VINTAGE_COLORS.map((c) => {
                const selected = c.id === accentId
                return (
                  <Tooltip key={c.id} title={c.label}>
                    <ButtonBase
                      onClick={() => setAccentId(c.id)}
                      aria-label={`Accent color ${c.label}`}
                      sx={{
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        bgcolor: c.value,
                        border: '2px solid',
                        borderColor: selected ? 'primary.main' : 'divider',
                        boxShadow: selected ? 3 : 1,
                        transition: 'transform 120ms',
                        transform: selected ? 'scale(1.1)' : 'scale(1)',
                      }}
                    />
                  </Tooltip>
                )
              })}
            </Stack>

            {/* Year + months ahead */}
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
              <ToggleButtonGroup
                value={selectedYear}
                exclusive
                size="small"
                onChange={handleYearChange}
              >
                <ToggleButton value={CURRENT_YEAR - 1}>{CURRENT_YEAR - 1}</ToggleButton>
                <ToggleButton value={CURRENT_YEAR}>{CURRENT_YEAR}</ToggleButton>
                <ToggleButton value={CURRENT_YEAR + 1}>{CURRENT_YEAR + 1}</ToggleButton>
              </ToggleButtonGroup>

              <FormControl size="small" disabled={maxMonths === 0}>
                <Select
                  value={monthsAhead}
                  onChange={(e) => setMonthsAhead(e.target.value)}
                  sx={{ minWidth: 120 }}
                >
                  {monthsOptions.map((o) => (
                    <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>

            <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={includePast}
                    onChange={(e) => setIncludePast(e.target.checked)}
                    size="small"
                  />
                }
                label={<Typography variant="caption">Include past gigs</Typography>}
              />
              {visibleGigs.some((g) => g.banner_path) && (
                <FormControlLabel
                  control={
                    <Switch
                      checked={showBanners}
                      onChange={(e) => setShowBanners(e.target.checked)}
                      size="small"
                    />
                  }
                  label={<Typography variant="caption">Show banners</Typography>}
                />
              )}
            </Stack>

            {/* Preview */}
            <Box
              sx={{
                width: previewMaxWidth,
                height: formatDef.height * scale,
                position: 'relative',
                bgcolor: 'grey.900',
                borderRadius: 1,
                overflow: 'hidden',
                boxShadow: 3,
              }}
            >
              <Box
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: formatDef.width,
                  height: formatDef.height,
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                }}
              >
                <TourShareCard
                  ref={cardRef}
                  gigs={visibleGigs}
                  photoSrc={photoSrc}
                  photoOpacity={photoOpacity}
                  zoom={format === 'story' ? zoom : undefined}
                  pan={pan}
                  accent={accentColor}
                  format={format}
                  socials={socials}
                  year={selectedYear}
                  logoSrc={logoSrc}
                  showBanners={showBanners}
                />
              </Box>
            </Box>

            {/* Photo controls */}
            <Box sx={{ width: previewMaxWidth, px: 1 }}>
              <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                Photo opacity
              </Typography>
              <Slider
                value={photoOpacity}
                onChange={(_, v) => setPhotoOpacity(v)}
                min={0}
                max={100}
                step={1}
                size="small"
                aria-label="Photo opacity"
                marks={[
                  { value: 0, label: 'None' },
                  { value: 50, label: 'Half' },
                  { value: 100, label: 'Full' },
                ]}
              />
              {format === 'story' && (
                <>
                  <Typography variant="caption" color="text.secondary" display="block" gutterBottom sx={{ mt: 1 }}>
                    Zoom
                  </Typography>
                  <Slider
                    value={zoom}
                    onChange={(_, v) => setZoom(v)}
                    min={0}
                    max={100}
                    step={1}
                    size="small"
                    aria-label="Photo zoom"
                    marks={[
                      { value: 0, label: 'Width' },
                      { value: 100, label: 'Height' },
                    ]}
                  />
                </>
              )}
              <Typography variant="caption" color="text.secondary" display="block" gutterBottom sx={{ mt: 1 }}>
                Pan
              </Typography>
              <Slider
                value={pan}
                onChange={(_, v) => setPan(v)}
                min={-100}
                max={100}
                step={1}
                size="small"
                aria-label="Photo pan"
                marks={[
                  { value: -100, label: '◀' },
                  { value: 0, label: '·' },
                  { value: 100, label: '▶' },
                ]}
              />
            </Box>

            {/* Photo carousel */}
            {photosLoading ? (
              <CircularProgress size={24} />
            ) : (
              <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', justifyContent: 'center' }}>
                {photos.map((p) => {
                  const selected = p.id === photoId
                  return (
                    <Stack key={p.id} spacing={0.5} sx={{ alignItems: 'center' }}>
                      <Tooltip title={p.label}>
                        <ButtonBase
                          onClick={() => setPhotoId(p.id)}
                          sx={{
                            width: 80,
                            height: 80,
                            borderRadius: 1,
                            overflow: 'hidden',
                            border: '3px solid',
                            borderColor: selected ? 'primary.main' : 'transparent',
                            outline: selected ? '1px solid' : 'none',
                            outlineColor: 'primary.light',
                            bgcolor: 'grey.800',
                          }}
                        >
                          <Box
                            component="img"
                            src={`/api/files/${p.object_key}`}
                            alt={p.label}
                            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={(e) => { e.currentTarget.style.opacity = 0.2 }}
                          />
                        </ButtonBase>
                      </Tooltip>
                      {isAdmin && (
                        <IconButton
                          size="small"
                          aria-label={`Delete ${p.label}`}
                          onClick={() => handlePhotoDelete(p)}
                          sx={{ color: 'error.main', p: 0.25 }}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Stack>
                  )
                })}

                {isAdmin && (
                  <>
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      style={{ display: 'none' }}
                      onChange={handlePhotoUpload}
                    />
                    <Stack spacing={0.5} sx={{ alignItems: 'center' }}>
                      <Tooltip title="Upload photo">
                        <ButtonBase
                          onClick={() => photoInputRef.current?.click()}
                          disabled={busy}
                          sx={{
                            width: 80,
                            height: 80,
                            borderRadius: 1,
                            border: '2px dashed',
                            borderColor: 'divider',
                            bgcolor: 'action.hover',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 0.5,
                            color: 'text.secondary',
                          }}
                        >
                          <AddPhotoAlternateIcon fontSize="small" />
                        </ButtonBase>
                      </Tooltip>
                      <Box sx={{ height: 22 }} />
                    </Stack>
                  </>
                )}
              </Stack>
            )}

            {visibleGigs.length === 0 && (
              <Typography variant="body2" color="text.secondary" textAlign="center">
                No gigs to display for this selection.
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>Close</Button>
          {canCopy && (
            <Button
              onClick={handleCopy}
              disabled={busy || visibleGigs.length === 0}
              startIcon={busy ? <CircularProgress size={16} /> : <ContentCopyIcon />}
            >
              Copy
            </Button>
          )}
          <Button
            variant="contained"
            onClick={handleDownload}
            disabled={busy || visibleGigs.length === 0}
            startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <DownloadIcon />}
          >
            Download PNG
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!snackbar}
        autoHideDuration={4000}
        onClose={() => setSnackbar(null)}
        message={snackbar?.msg}
      />
    </>
  )
}
