import { useContext, useEffect, useRef, useState } from 'react'
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
import InputLabel from '@mui/material/InputLabel'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Slider from '@mui/material/Slider'
import Snackbar from '@mui/material/Snackbar'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import DeleteIcon from '@mui/icons-material/Delete'
import DownloadIcon from '@mui/icons-material/Download'
import { useTranslation } from 'react-i18next'
import GigShareCard from './share/GigShareCard.tsx'
import { STICKER_CONFIGS } from './share/stickerConfigs.ts'
import { SHARE_VARIATIONS, SHARE_VARIATION_MAP } from './share/variations/index.ts'
import { AuthContext } from '../contexts/authContext.ts'
import { getProfile } from '../api/profile.ts'
import { getSharePhotos, uploadSharePhoto, deleteSharePhoto } from '../api/sharePhotos.ts'
import {
  buildShareFilename,
  buildSharePdfFilename,
  downloadBlob,
  downloadPdf,
  renderLayeredPdf,
  renderNodeToBlob,
  SHARE_FORMATS,
  SHARE_STICKER_POSITIONS,
  SHARE_VINTAGE_COLORS,
} from '../utils/shareCard.ts'
import { compressPhoto } from '../utils/compressImage.ts'
import type { Gig, Id } from '../types/entities.ts'

interface LocalSharePhoto {
  id?: Id
  object_key?: string
  label?: string
}

interface GigShareDialogProps {
  open: boolean
  onClose: () => void
  gig?: Gig | null
}

export default function GigShareDialog({ open, onClose, gig }: Readonly<GigShareDialogProps>) {
  const { t } = useTranslation(['gigs', 'common'])
  const { user } = useContext(AuthContext)
  const isAdmin = user?.isSuperAdmin || user?.activeTenantRole === 'tenant_admin'

  const [photos, setPhotos] = useState<LocalSharePhoto[]>([])

  const [photoId, setPhotoId] = useState<Id | null>(null)
  const [photosLoading, setPhotosLoading] = useState(false)
  const [format, setFormat] = useState('square')
  const [accentId, setAccentId] = useState(SHARE_VINTAGE_COLORS[0].id)
  const [variation, setVariation] = useState(SHARE_VARIATIONS[0].id)
  const [zoom, setZoom] = useState(100)
  const [pan, setPan] = useState(0)
  const [sticker, setSticker] = useState<string | null>(null)
  const [stickerPos, setStickerPos] = useState('right-top')
  const [busy, setBusy] = useState(false)
  const [snackbar, setSnackbar] = useState<{ msg: string } | null>(null)
  const [socials, setSocials] = useState({ instagram: '', facebook: '', tiktok: '' })
  const [logoSrc, setLogoSrc] = useState('/share/logo.png')
  const [logoDarkSrc, setLogoDarkSrc] = useState<string | null>(null)
  const [bandName, setBandName] = useState('')
  const [downloadMenuAnchor, setDownloadMenuAnchor] = useState<HTMLElement | null>(null)
  const [showBanner, setShowBanner] = useState(false)
  const [showLogo, setShowLogo] = useState(true)
  const [useDarkLogo, setUseDarkLogo] = useState(false)
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)

  const formatDef = SHARE_FORMATS[format]
  const activeVariation = SHARE_VARIATION_MAP[variation] ?? SHARE_VARIATION_MAP.vintage
  const supports = activeVariation.supports
  const selectedPhoto = photos.find((p) => p.id === photoId)
  const photoSrc = selectedPhoto ? `/api/files/${selectedPhoto.object_key}` : null
  const gigBannerSrc = gig?.banner_path ? `/api/files/${gig.banner_path}` : null
  const bannerSrc = supports.banner && showBanner && gigBannerSrc ? gigBannerSrc : null
  const accentColor =
    SHARE_VINTAGE_COLORS.find((c) => c.id === accentId)?.value
    || SHARE_VINTAGE_COLORS[0].value

  async function loadPhotos() {
    setPhotosLoading(true)
    try {
      const rows = await getSharePhotos() as LocalSharePhoto[]
      setPhotos(rows)
      setPhotoId((prev) => {
        if (prev && rows.some((r: LocalSharePhoto) => r.id === prev)) return prev
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
      setVariation(SHARE_VARIATIONS[0].id)
      setZoom(100)
      setPan(0)
      setSticker(null)
      setStickerPos('right-top')
      setBusy(false)
      setDownloadMenuAnchor(null)
      setShowBanner(!!gig?.banner_path)
      setShowLogo(true)
      setUseDarkLogo(false)
      setBandName('')
      loadPhotos()
      getProfile().then((p) => {
        setSocials({
          instagram: p?.instagram_handle || '',
          facebook: p?.facebook_handle || '',
          tiktok: p?.tiktok_handle || '',
        })
        setLogoSrc(p?.logo_path ? `/api/files/${p.logo_path}` : '/share/logo.png')
        setLogoDarkSrc(p?.logo_dark_path ? `/api/files/${p.logo_dark_path}` : null)
        setBandName(p?.band_name || '')
      }).catch(() => {})
    }
  }, [open, gig?.banner_path])

  const previewMaxWidth = 320
  const scale = previewMaxWidth / formatDef.width

  async function snapshot() {
    if (!cardRef.current) return null
    return renderNodeToBlob(cardRef.current, {
      width: formatDef.width,
      height: formatDef.height,
    })
  }

  async function handleDownload() {
    setBusy(true)
    try {
      const blob = await snapshot()
      if (!blob) throw new Error(t($ => $.share.snapshotFailed))
      downloadBlob(blob, buildShareFilename(gig, format))
    } catch (e) {
      setSnackbar({ msg: (e as Error).message || t($ => $.share.downloadFailed) })
    } finally {
      setBusy(false)
    }
  }

  async function handleDownloadPdf() {
    setBusy(true)
    try {
      if (!cardRef.current) throw new Error(t($ => $.gigShare.cardNotReady))
      const pdf = await renderLayeredPdf(cardRef.current, {
        width: formatDef.width,
        height: formatDef.height,
      })
      downloadPdf(pdf, buildSharePdfFilename(gig, format))
    } catch (e) {
      setSnackbar({ msg: (e as Error).message || t($ => $.gigShare.pdfExportFailed) })
    } finally {
      setBusy(false)
    }
  }

  function handleDownloadMenuClose() {
    setDownloadMenuAnchor(null)
  }

  function handleDownloadOption(downloadFn: () => void) {
    setDownloadMenuAnchor(null)
    downloadFn()
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setBusy(true)
    try {
      const compressed = await compressPhoto(file)
      const newPhoto = await uploadSharePhoto(compressed)
      setPhotos((prev) => [...prev, newPhoto as LocalSharePhoto])
      setPhotoId(newPhoto.id ?? null)
    } catch (err) {
      setSnackbar({ msg: (err as Error).message || t($ => $.shareEditor.uploadFailed) })
    } finally {
      setBusy(false)
    }
  }

  async function handlePhotoDelete(photo: LocalSharePhoto) {
    try {
      await deleteSharePhoto(photo.id!)
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

  return (
    <>
      <Dialog
        open={open}
        onClose={busy ? undefined : onClose}
        maxWidth="md"
        fullWidth
        onClick={(e) => e.stopPropagation()}
      >
        <DialogTitle>{t($ => $.gigShare.title)}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ alignItems: 'center' }}>
            <ToggleButtonGroup
              value={format}
              exclusive
              size="small"
              onChange={(_, v) => v && setFormat(v)}
            >
              <ToggleButton value="square">{t($ => $.share.square)}</ToggleButton>
              <ToggleButton value="story">{t($ => $.share.story)}</ToggleButton>
            </ToggleButtonGroup>

            <ToggleButtonGroup
              value={variation}
              exclusive
              size="small"
              onChange={(_, v) => v && setVariation(v)}
              aria-label={t($ => $.gigShare.cardVariation)}
            >
              {SHARE_VARIATIONS.map((v) => (
                <ToggleButton key={v.id} value={v.id}>{v.label}</ToggleButton>
              ))}
            </ToggleButtonGroup>

            {supports.accent && (
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
            )}

            {/* event banner toggle — hidden on mobile, shown inline near sliders instead */}
            {supports.banner && gigBannerSrc && (
              <FormControlLabel
                sx={{ display: { xs: 'none', sm: 'flex' } }}
                control={
                  <Switch
                    checked={showBanner}
                    onChange={(e) => setShowBanner(e.target.checked)}
                    size="small"
                  />
                }
                label={t($ => $.gigShare.showEventBanner)}
              />
            )}

            {supports.toggleLogo && (
              <FormControlLabel
                control={
                  <Switch
                    checked={showLogo}
                    onChange={(e) => setShowLogo(e.target.checked)}
                    size="small"
                  />
                }
                label={t($ => $.gigShare.showLogo)}
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
                label={t($ => $.shareEditor.darkLogo)}
              />
            )}

             {/* event banner toggle — mobile only, shown below sliders where it's reachable */}
            {supports.banner && gigBannerSrc && (
              <FormControlLabel
                sx={{ display: { xs: 'flex', sm: 'none' } }}
                control={
                  <Switch
                    checked={showBanner}
                    onChange={(e) => setShowBanner(e.target.checked)}
                    size="small"
                  />
                }
                label={t($ => $.gigShare.showEventBanner)}
              />
            )}

            {/* overlay controls */}
            {supports.sticker && (
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', justifyContent: 'center' }}>
                <FormControl size="small" sx={{ minWidth: 160 }}>
                  <InputLabel>{t($ => $.gigShare.overlay)}</InputLabel>
                  <Select
                    value={sticker ?? ''}
                    label={t($ => $.gigShare.overlay)}
                    onChange={(e) => setSticker(e.target.value || null)}
                  >
                    <MenuItem value="">{t($ => $.state.none, { ns: 'common' })}</MenuItem>
                    {Object.keys(STICKER_CONFIGS).map((id) => (
                      <MenuItem key={id} value={id}>
                        {id.replaceAll('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                {sticker && (
                  <ToggleButtonGroup
                    value={stickerPos}
                    exclusive
                    size="small"
                    onChange={(_, v) => v && setStickerPos(v)}
                    aria-label={t($ => $.gigShare.overlayPosition)}
                  >
                    {SHARE_STICKER_POSITIONS.map((p) => (
                      <ToggleButton key={p.id} value={p.id}>{p.label}</ToggleButton>
                    ))}
                  </ToggleButtonGroup>
                )}
              </Stack>
            )}

            {/* preview */}
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
                <GigShareCard
                  ref={cardRef}
                  gig={gig}
                  photoSrc={photoSrc}
                  format={format}
                  zoom={format === 'story' ? zoom : undefined}
                  pan={pan}
                  accent={accentColor}
                  variation={variation}
                  socials={socials}
                  sticker={sticker}
                  stickerPosition={stickerPos}
                  logoSrc={useDarkLogo && logoDarkSrc ? logoDarkSrc : logoSrc}
                  bannerSrc={bannerSrc}
                  bandName={bandName}
                  showLogo={showLogo}
                />
              </Box>
            </Box>

            <Box sx={{ width: previewMaxWidth, px: 1 }}>
              {format === 'story' && supports.zoom && (
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
              )}
              {supports.pan && (
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
              )}
            </Box>

            {/* photo carousel */}
            {photosLoading ? (
              <CircularProgress size={24} />
            ) : (
              <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', justifyContent: 'center' }}>
                {photos.map((p) => {
                  const selected = p.id === photoId
                  return (
                    <Stack key={String(p.id)} spacing={0.5} sx={{ alignItems: 'center' }}>
                      <Tooltip title={p.label}>
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
                            alt={p.label}
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
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>{t($ => $.actions.close, { ns: 'common' })}</Button>
          <Button
            id="gig-share-download-button"
            variant="contained"
            onClick={(e) => setDownloadMenuAnchor(e.currentTarget)}
            disabled={busy}
            startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <DownloadIcon />}
            endIcon={<ArrowDropDownIcon />}
            aria-controls={downloadMenuAnchor ? 'gig-share-download-menu' : undefined}
            aria-haspopup="menu"
            aria-expanded={downloadMenuAnchor ? 'true' : undefined}
          >
            {t($ => $.gigShare.download)}
          </Button>
          <Menu
            id="gig-share-download-menu"
            anchorEl={downloadMenuAnchor}
            open={Boolean(downloadMenuAnchor)}
            onClose={handleDownloadMenuClose}
            slotProps={{ list: { 'aria-labelledby': 'gig-share-download-button' } }}
          >
            <MenuItem onClick={() => handleDownloadOption(handleDownload)}>{t($ => $.gigShare.formatPng)}</MenuItem>
            <MenuItem onClick={() => handleDownloadOption(handleDownloadPdf)}>{t($ => $.gigShare.formatPdf)}</MenuItem>
          </Menu>
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
