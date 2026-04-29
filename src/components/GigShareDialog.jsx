import { useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Slider from '@mui/material/Slider'
import Snackbar from '@mui/material/Snackbar'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import DownloadIcon from '@mui/icons-material/Download'
import GigShareCard from './GigShareCard.jsx'
import { STICKER_CONFIGS } from './share/stickerConfigs.js'
import { getProfile } from '../api/profile.js'
import {
  buildShareFilename,
  buildSharePdfFilename,
  downloadBlob,
  downloadPdf,
  renderLayeredPdf,
  renderNodeToBlob,
  SHARE_FORMATS,
  SHARE_PHOTOS,
  SHARE_STICKER_POSITIONS,
  SHARE_VARIATIONS,
  SHARE_VINTAGE_COLORS,
} from '../utils/shareCard.js'

export default function GigShareDialog({ open, onClose, gig }) {
  const [photoId, setPhotoId] = useState(SHARE_PHOTOS[0].id)
  const [format, setFormat] = useState('square')
  const [accentId, setAccentId] = useState(SHARE_VINTAGE_COLORS[0].id)
  const [variation, setVariation] = useState(SHARE_VARIATIONS[0].id)
  const [zoom, setZoom] = useState(100)
  const [pan, setPan] = useState(0)
  const [sticker, setSticker] = useState(null)
  const [stickerPos, setStickerPos] = useState('right-top')
  const [busy, setBusy] = useState(false)
  const [snackbar, setSnackbar] = useState(null)
  const [socials, setSocials] = useState({})
  const [downloadMenuAnchor, setDownloadMenuAnchor] = useState(null)
  const cardRef = useRef(null)

  const formatDef = SHARE_FORMATS[format]
  const photoSrc = SHARE_PHOTOS.find((p) => p.id === photoId)?.src
  const accentColor =
    SHARE_VINTAGE_COLORS.find((c) => c.id === accentId)?.value
    || SHARE_VINTAGE_COLORS[0].value

  useEffect(() => {
    if (open) {
      setPhotoId(SHARE_PHOTOS[0].id)
      setFormat('square')
      setAccentId(SHARE_VINTAGE_COLORS[0].id)
      setVariation(SHARE_VARIATIONS[0].id)
      setZoom(100)
      setPan(0)
      setSticker(null)
      setStickerPos('right-top')
      setBusy(false)
      setDownloadMenuAnchor(null)
      getProfile().then((p) => setSocials({
        instagram: p?.instagram_handle || '',
        facebook: p?.facebook_handle || '',
        tiktok: p?.tiktok_handle || '',
      })).catch(() => {})
    }
  }, [open])

  // scale the 1080-wide preview to fit roughly 360px wide in the dialog
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
      if (!blob) throw new Error('Snapshot failed')
      downloadBlob(blob, buildShareFilename(gig, format))
    } catch (e) {
      setSnackbar({ severity: 'error', msg: e.message || 'Download failed' })
    } finally {
      setBusy(false)
    }
  }

  async function handleDownloadPdf() {
    setBusy(true)
    try {
      const pdf = await renderLayeredPdf(cardRef.current, {
        width: formatDef.width,
        height: formatDef.height,
      })
      downloadPdf(pdf, buildSharePdfFilename(gig, format))
    } catch (e) {
      setSnackbar({ severity: 'error', msg: e.message || 'PDF export failed' })
    } finally {
      setBusy(false)
    }
  }

  function handleDownloadMenuClose() {
    setDownloadMenuAnchor(null)
  }

  function handleDownloadOption(downloadFn) {
    setDownloadMenuAnchor(null)
    downloadFn()
  }

  return (
    <>
      <Dialog
        open={open}
        onClose={busy ? undefined : onClose}
        maxWidth="md"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogTitle>Share gig as image</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ alignItems: 'center' }}>
            <ToggleButtonGroup
              value={format}
              exclusive
              size="small"
              onChange={(_, v) => v && setFormat(v)}
            >
              <ToggleButton value="square">Square 1:1</ToggleButton>
              <ToggleButton value="story">Story 9:16</ToggleButton>
            </ToggleButtonGroup>

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

            <ToggleButtonGroup
              value={variation}
              exclusive
              size="small"
              onChange={(_, v) => v && setVariation(v)}
              aria-label="Card variation"
            >
              {SHARE_VARIATIONS.map((v) => (
                <ToggleButton key={v.id} value={v.id}>{v.label}</ToggleButton>
              ))}
            </ToggleButtonGroup>

            {/* overlay controls */}
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', justifyContent: 'center' }}>
              <FormControl size="small" sx={{ minWidth: 160 }}>
                <InputLabel>Overlay</InputLabel>
                <Select
                  value={sticker ?? ''}
                  label="Overlay"
                  onChange={(e) => setSticker(e.target.value || null)}
                >
                  <MenuItem value="">None</MenuItem>
                  {Object.keys(STICKER_CONFIGS).map((id) => (
                    <MenuItem key={id} value={id}>
                      {id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
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
                  aria-label="Overlay position"
                >
                  {SHARE_STICKER_POSITIONS.map((p) => (
                    <ToggleButton key={p.id} value={p.id}>{p.label}</ToggleButton>
                  ))}
                </ToggleButtonGroup>
              )}
            </Stack>

            {/* preview shell — scaled-down view of the same node we snapshot */}
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
                />
              </Box>
            </Box>

            <Box sx={{ width: previewMaxWidth, px: 1 }}>
              {format === 'story' && (
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
              )}
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

            <Stack direction="row" spacing={1.5}>
              {SHARE_PHOTOS.map((p) => {
                const selected = p.id === photoId
                return (
                  <Tooltip key={p.id} title={p.label}>
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
                        src={p.src}
                        alt={p.label}
                        sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={(e) => { e.currentTarget.style.opacity = 0.2 }}
                      />
                    </ButtonBase>
                  </Tooltip>
                )
              })}
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>Close</Button>
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
            Download
          </Button>
          <Menu
            id="gig-share-download-menu"
            anchorEl={downloadMenuAnchor}
            open={Boolean(downloadMenuAnchor)}
            onClose={handleDownloadMenuClose}
            MenuListProps={{ 'aria-labelledby': 'gig-share-download-button' }}
          >
            <MenuItem onClick={() => handleDownloadOption(handleDownload)}>png</MenuItem>
            <MenuItem onClick={() => handleDownloadOption(handleDownloadPdf)}>pdf</MenuItem>
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
