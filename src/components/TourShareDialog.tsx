import type { Gig, Id } from '../types/entities.ts'
import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import TourShareCard from './share/TourShareCard.tsx'
import { AuthContext } from '../contexts/authContext.ts'
import { getProfile } from '../api/profile.ts'
import { getSharePhotos, uploadSharePhoto, deleteSharePhoto } from '../api/sharePhotos.ts'
import {
  buildTourShareFilename,
  canCopyImageToClipboard,
  copyBlobToClipboard,
  downloadBlob,
  renderNodeToBlob,
  SHARE_FORMATS,
  SHARE_VINTAGE_COLORS,
} from '../utils/shareCard.ts'
import { compressPhoto } from '../utils/compressImage.ts'

interface SharePhoto {
  id?: Id
  object_key?: string
  label?: string
}

const NOW = new Date()
const CURRENT_YEAR = NOW.getFullYear()
const CURRENT_MONTH = NOW.getMonth() // 0-indexed

function maxMonthsForYear(year: number): number {
  if (year === CURRENT_YEAR) return 12 - CURRENT_MONTH
  if (year > CURRENT_YEAR) return 12
  return 0
}

interface TourShareDialogProps {
  open: boolean
  onClose: () => void
  gigs?: Gig[]
}

export default function TourShareDialog({ open, onClose, gigs = [] }: Readonly<TourShareDialogProps>) {
  const { t } = useTranslation(['gigs', 'common'])
  const { user } = useContext(AuthContext)
  const isAdmin = user?.isSuperAdmin || user?.activeTenantRole === 'tenant_admin'

  const [photos, setPhotos] = useState<SharePhoto[]>([])
  const [photoId, setPhotoId] = useState<Id | null>(null)
  const [photosLoading, setPhotosLoading] = useState(false)
  const [format, setFormat] = useState('square')
  const [accentId, setAccentId] = useState(SHARE_VINTAGE_COLORS[0].id)
  const [photoOpacity, setPhotoOpacity] = useState(35)
  const [zoom, setZoom] = useState(100)
  const [pan, setPan] = useState(0)
  const [showBanners, setShowBanners] = useState(false)
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR)
  const [monthsAhead, setMonthsAhead] = useState<number | 'all'>('all')
  const [includePast, setIncludePast] = useState(false)
  const [socials, setSocials] = useState<Record<string, string>>({})
  const [logoSrc, setLogoSrc] = useState('/share/logo.png')
  const [logoDarkSrc, setLogoDarkSrc] = useState<string | null>(null)
  const [useDarkLogo, setUseDarkLogo] = useState(false)
  const [busy, setBusy] = useState(false)
  const [snackbar, setSnackbar] = useState<{ msg: string } | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  const canCopy = useMemo(() => canCopyImageToClipboard(), [])
  const formatDef = SHARE_FORMATS[format as keyof typeof SHARE_FORMATS]
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
      setUseDarkLogo(false)
      setBusy(false)
      loadPhotos()
      getProfile().then((p) => {
        setSocials({
          instagram: (p as Record<string, unknown>)?.instagram_handle as string || '',
          facebook: (p as Record<string, unknown>)?.facebook_handle as string || '',
          tiktok: (p as Record<string, unknown>)?.tiktok_handle as string || '',
        })
        setLogoSrc((p as Record<string, unknown>)?.logo_path ? `/api/files/${(p as Record<string, unknown>).logo_path}` : '/share/logo.png')
        setLogoDarkSrc((p as Record<string, unknown>)?.logo_dark_path ? `/api/files/${(p as Record<string, unknown>).logo_dark_path}` : null)
      }).catch(() => {})
    }
  }, [open])  

  function handleYearChange(_: React.MouseEvent, v: number | null) {
    if (!v) return
    setSelectedYear(v)
    const newMax = maxMonthsForYear(v)
    if (monthsAhead !== 'all' && (newMax === 0 || Number(monthsAhead) > newMax)) {
      setMonthsAhead('all')
    }
  }

  const visibleGigs = useMemo(() => {
    let cutoff: string | null = null
    if (monthsAhead !== 'all') {
      const d = new Date(NOW)
      d.setMonth(d.getMonth() + Number(monthsAhead))
      cutoff = d.toISOString().slice(0, 10)
    }
    return gigs.filter((g) => {
      const gigDate = String(g.event_date).slice(0, 10)
      if (new Date(String(g.event_date)).getFullYear() !== selectedYear) return false
      if (!includePast && gigDate < today) return false
      if (cutoff !== null && gigDate > cutoff) return false
      return true
    })
  }, [gigs, selectedYear, monthsAhead, includePast, today])

  const previewMaxWidth = 320
  const scale = previewMaxWidth / formatDef.width

  async function snapshot(): Promise<Blob | null> {
    if (!cardRef.current) return null
    return renderNodeToBlob(cardRef.current, { width: formatDef.width, height: formatDef.height })
  }

  async function handleDownload() {
    setBusy(true)
    try {
      const blob = await snapshot()
      if (!blob) throw new Error(t($ => $.share.snapshotFailed))
      downloadBlob(blob, buildTourShareFilename(selectedYear, format))
    } catch (e) {
      setSnackbar({ msg: (e as Error).message || t($ => $.share.downloadFailed) })
    } finally {
      setBusy(false)
    }
  }

  async function handleCopy() {
    setBusy(true)
    try {
      const blob = await snapshot()
      if (!blob) throw new Error(t($ => $.share.snapshotFailed))
      await copyBlobToClipboard(blob)
      setSnackbar({ msg: t($ => $.share.imageCopied) })
    } catch (e) {
      setSnackbar({ msg: (e as Error).message || t($ => $.share.copyFailed) })
    } finally {
      setBusy(false)
    }
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setBusy(true)
    try {
      const compressed = await compressPhoto(file)
      const newPhoto = await uploadSharePhoto(compressed)
      setPhotos((prev) => [...prev, newPhoto])
      setPhotoId(newPhoto.id ?? null)
    } catch (err) {
      setSnackbar({ msg: (err as Error).message || t($ => $.shareEditor.uploadFailed) })
    } finally {
      setBusy(false)
    }
  }

  async function handlePhotoDelete(photo: SharePhoto) {
    if (!photo.id) return
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
      setSnackbar({ msg: (err as Error).message || t($ => $.shareEditor.deleteFailed) })
    }
  }

  const monthsOptions = [
    { value: 'all' as const, label: t($ => $.tourShare.monthsAll) },
    ...Array.from({ length: maxMonths }, (_, i) => ({
      value: i + 1,
      label: t($ => $.tourShare.monthsAhead, { count: i + 1 }),
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
        <DialogTitle>{t($ => $.tourShare.title)}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ alignItems: 'center' }}>

            {/* Format */}
            <ToggleButtonGroup
              value={format}
              exclusive
              size="small"
              onChange={(_, v) => v && setFormat(v)}
            >
              <ToggleButton value="square">{t($ => $.share.square)}</ToggleButton>
              <ToggleButton value="story">{t($ => $.share.story)}</ToggleButton>
            </ToggleButtonGroup>

            {/* Accent colors */}
            <Stack direction="row" spacing={1.25}>
              {SHARE_VINTAGE_COLORS.map((c) => {
                const selected = c.id === accentId
                return (
                  <Tooltip key={c.id} title={c.label}>
                    <ButtonBase
                      onClick={() => setAccentId(c.id)}
                      aria-label={t($ => $.shareEditor.accentColorAria, { label: c.label })}
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
                  onChange={(e) => setMonthsAhead(e.target.value as number | 'all')}
                  sx={{ minWidth: 120 }}
                >
                  {monthsOptions.map((o) => (
                    <MenuItem key={String(o.value)} value={o.value}>{o.label}</MenuItem>
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
                label={<Typography variant="caption">{t($ => $.tourShare.includePastGigs)}</Typography>}
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
                  label={<Typography variant="caption">{t($ => $.tourShare.showBanners)}</Typography>}
                />
              )}
              {logoDarkSrc && (
                <FormControlLabel
                  control={
                    <Switch
                      checked={useDarkLogo}
                      onChange={(e) => setUseDarkLogo(e.target.checked)}
                      size="small"
                    />
                  }
                  label={<Typography variant="caption">{t($ => $.shareEditor.darkLogo)}</Typography>}
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
                  photoSrc={photoSrc ?? undefined}
                  photoOpacity={photoOpacity}
                  zoom={format === 'story' ? zoom : undefined}
                  pan={pan}
                  accent={accentColor}
                  format={format}
                  socials={socials}
                  year={selectedYear}
                  logoSrc={useDarkLogo && logoDarkSrc ? logoDarkSrc : logoSrc}
                  showBanners={showBanners}
                />
              </Box>
            </Box>

            {/* Photo controls */}
            <Box sx={{ width: previewMaxWidth, px: 1 }}>
              <Typography variant="caption" color="text.secondary" gutterBottom sx={{ display: 'block' }}>
                {t($ => $.tourShare.photoOpacity)}
              </Typography>
              <Slider
                value={photoOpacity}
                onChange={(_, v) => setPhotoOpacity(v as number)}
                min={0}
                max={100}
                step={1}
                size="small"
                aria-label={t($ => $.tourShare.photoOpacity)}
                marks={[
                  { value: 0, label: t($ => $.state.none, { ns: 'common' }) },
                  { value: 50, label: t($ => $.tourShare.markHalf) },
                  { value: 100, label: t($ => $.tourShare.markFull) },
                ]}
              />
              {format === 'story' && (
                <>
                  <Typography variant="caption" color="text.secondary" gutterBottom sx={{ display: 'block', mt: 1 }}>
                    {t($ => $.tourShare.zoom)}
                  </Typography>
                  <Slider
                    value={zoom}
                    onChange={(_, v) => setZoom(v as number)}
                    min={0}
                    max={100}
                    step={1}
                    size="small"
                    aria-label={t($ => $.shareEditor.photoZoom)}
                    marks={[
                      { value: 0, label: t($ => $.shareEditor.markWidth) },
                      { value: 100, label: t($ => $.shareEditor.markHeight) },
                    ]}
                  />
                </>
              )}
              <Typography variant="caption" color="text.secondary" gutterBottom sx={{ display: 'block', mt: 1 }}>
                {t($ => $.tourShare.pan)}
              </Typography>
              <Slider
                value={pan}
                onChange={(_, v) => setPan(v as number)}
                min={-100}
                max={100}
                step={1}
                size="small"
                aria-label={t($ => $.shareEditor.photoPan)}
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
                    <Stack key={String(p.id)} spacing={0.5} sx={{ alignItems: 'center' }}>
                      <Tooltip title={p.label ?? ''}>
                        <ButtonBase
                          onClick={() => setPhotoId(p.id ?? null)}
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
                            alt={p.label ?? ''}
                            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={(e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.opacity = '0.2' }}
                          />
                        </ButtonBase>
                      </Tooltip>
                      {isAdmin && (
                        <IconButton
                          size="small"
                          aria-label={t($ => $.shareEditor.deletePhotoAria, { label: p.label })}
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
                      <Tooltip title={t($ => $.shareEditor.uploadPhoto)}>
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
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
                {t($ => $.tourShare.noGigsForSelection)}
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>{t($ => $.common.actions.close)}</Button>
          {canCopy && (
            <Button
              onClick={handleCopy}
              disabled={busy || visibleGigs.length === 0}
              startIcon={busy ? <CircularProgress size={16} /> : <ContentCopyIcon />}
            >
              {t($ => $.common.actions.copy)}
            </Button>
          )}
          <Button
            variant="contained"
            onClick={handleDownload}
            disabled={busy || visibleGigs.length === 0}
            startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <DownloadIcon />}
          >
            {t($ => $.share.downloadPng)}
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
