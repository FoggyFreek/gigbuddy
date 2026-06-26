import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import CircularProgress from '@mui/material/CircularProgress'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import DownloadIcon from '@mui/icons-material/Download'
import Snackbar from '@mui/material/Snackbar'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import BannerMosaicCard from './share/BannerMosaicCard.tsx'
import {
  buildBannerMosaicFilename,
  canCopyImageToClipboard,
  copyBlobToClipboard,
  downloadBlob,
  renderNodeToBlob,
  SHARE_FORMATS,
  SHARE_VINTAGE_COLORS,
} from '../utils/shareCard.ts'
import type { Gig } from '../types/entities.ts'

interface BannerMosaicDialogProps {
  open: boolean
  onClose: () => void
  gigs?: Gig[]
}

const PREVIEW_MAX_WIDTH = 320
const BACKGROUND_COLORS = [
  { id: 'black', label: 'Black', value: '#000000' },
  ...SHARE_VINTAGE_COLORS,
]

export default function BannerMosaicDialog({ open, onClose, gigs = [] }: BannerMosaicDialogProps) {
  const { t } = useTranslation(['gigs', 'common'])
  const [format, setFormat] = useState('square')
  const [selectedYear, setSelectedYear] = useState<number | 'all'>('all')
  const [backgroundId, setBackgroundId] = useState(BACKGROUND_COLORS[0].id)
  const [busy, setBusy] = useState(false)
  const [snackbar, setSnackbar] = useState<{ msg: string } | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)

  const canCopy = useMemo(() => canCopyImageToClipboard(), [])
  const formatDef = SHARE_FORMATS[format]
  const scale = PREVIEW_MAX_WIDTH / formatDef.width
  const backgroundColor =
    BACKGROUND_COLORS.find((c) => c.id === backgroundId)?.value || BACKGROUND_COLORS[0].value

  const gigsWithBanners = useMemo(
    () => gigs.filter((g) => g.banner_path),
    [gigs],
  )

  const availableYears = useMemo<number[]>(() => {
    const years = new Set(
      gigsWithBanners.map((g) => new Date(g.event_date as string).getFullYear()),
    )
    return Array.from(years).sort((a, b) => b - a)
  }, [gigsWithBanners])

  const filteredGigs = useMemo(() => {
    if (selectedYear === 'all') return gigsWithBanners
    return gigsWithBanners.filter(
      (g) => new Date(g.event_date as string).getFullYear() === selectedYear,
    )
  }, [gigsWithBanners, selectedYear])

  function handleYearChange(_: React.MouseEvent, v: number | 'all') {
    if (v !== null) setSelectedYear(v)
  }

  async function snapshot() {
    if (!cardRef.current) return null
    return renderNodeToBlob(cardRef.current, { width: formatDef.width, height: formatDef.height })
  }

  async function handleDownload() {
    setBusy(true)
    try {
      const blob = await snapshot()
      if (!blob) throw new Error(t($ => $.share.snapshotFailed))
      downloadBlob(blob, buildBannerMosaicFilename(String(selectedYear), format))
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

  return (
    <>
      <Dialog
        open={open}
        onClose={busy ? undefined : onClose}
        maxWidth="md"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogTitle>{t($ => $.bannerMosaic.title)}</DialogTitle>
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

            {/* Year */}
            <ToggleButtonGroup
              value={selectedYear}
              exclusive
              size="small"
              onChange={handleYearChange}
            >
              <ToggleButton value="all">{t($ => $.bannerMosaic.allTime)}</ToggleButton>
              {availableYears.map((y) => (
                <ToggleButton key={y} value={y}>{y}</ToggleButton>
              ))}
            </ToggleButtonGroup>

            {/* Background color */}
            <Stack direction="row" spacing={1.25}>
              {BACKGROUND_COLORS.map((c) => {
                const selected = c.id === backgroundId
                return (
                  <Tooltip key={c.id} title={c.label}>
                    <ButtonBase
                      onClick={() => setBackgroundId(c.id)}
                      aria-label={t($ => $.bannerMosaic.backgroundColorAria, { label: c.label })}
                      aria-pressed={selected}
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

            {/* Preview */}
            <Box
              sx={{
                width: PREVIEW_MAX_WIDTH,
                height: formatDef.height * scale,
                position: 'relative',
                bgcolor: 'grey.900',
                borderRadius: 1,
                overflow: 'hidden',
                boxShadow: 3,
              }}
            >
              {filteredGigs.length > 0 ? (
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
                  <BannerMosaicCard
                    ref={cardRef}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    gigs={filteredGigs as any}
                    format={format as 'square' | 'story'}
                    backgroundColor={backgroundColor}
                  />
                </Box>
              ) : (
                <Box
                  sx={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    px: 2,
                  }}
                >
                  <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
                    {t($ => $.bannerMosaic.noBanners)}
                  </Typography>
                </Box>
              )}
            </Box>

            <Typography variant="caption" color="text.secondary">
              {t($ => $.bannerMosaic.bannerCount, { count: filteredGigs.length })}
            </Typography>

          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>{t($ => $.common.actions.close)}</Button>
          {canCopy && (
            <Button
              onClick={handleCopy}
              disabled={busy || filteredGigs.length === 0}
              startIcon={busy ? <CircularProgress size={16} /> : <ContentCopyIcon />}
            >
              {t($ => $.common.actions.copy)}
            </Button>
          )}
          <Button
            variant="contained"
            onClick={handleDownload}
            disabled={busy || filteredGigs.length === 0}
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
