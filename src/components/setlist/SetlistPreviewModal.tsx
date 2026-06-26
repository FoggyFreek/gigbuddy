import type { ReactNode } from 'react'
import type { SetlistSet, SetlistItem } from '../../types/entities.ts'
import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactDOM from 'react-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'
import PrintIcon from '@mui/icons-material/Print'
import { formatDuration } from '../../utils/formatDuration.ts'

interface PageRow {
  item: SetlistItem
  order: number | null
}

interface Page {
  set: SetlistSet
  rows: PageRow[]
}

// Turn the raw sets into per-page view models, assigning a running song order
// across the whole setlist (songs only) and filtering out pauses/breaks unless
// asked for. Non-song items never carry an order. We recompute here rather than
// reuse getSongOrder from the editor page (that helper takes an item id).
function buildPages(sets: SetlistSet[], showPauseAndBreaks: boolean): Page[] {
  let songCounter = 0
  return (sets || []).map((set) => {
    const rows: PageRow[] = []
    for (const item of set.items || []) {
      let order: number | null = null
      if (item.item_type === 'song') {
        songCounter += 1
        order = songCounter
      } else if (!showPauseAndBreaks) {
        continue
      }
      rows.push({ item, order })
    }
    return { set, rows }
  })
}

// Larger fonts for short sets, shrinking down for long ones, clamped to a
// readable range. Guard against division by zero for empty sets.
function pageFontSize(rowCount: number): number {
  return Math.max(12, Math.min(22, Math.floor(240 / Math.max(rowCount, 1))))
}

// A4 in CSS pixels at 96dpi (1in = 96px, 1in = 25.4mm). The visible preview
// expresses padding and font sizes as fractions of this width so content scales
// with the responsive page frame instead of being cropped.
const A4_WIDTH_PX = (210 * 96) / 25.4
const A4_HEIGHT_PX = (297 * 96) / 25.4
const A4_PADDING_PX = (20 * 96) / 25.4

interface PageContentProps {
  page: Page
  showKey: boolean
  showBpm: boolean
  showNotes: boolean
}

// The page body, shared by the on-screen preview and the hidden print portal so
// both stay in sync. Plain elements + inline styles keep it print-friendly.
function PageContent({ page, showKey, showBpm, showNotes }: PageContentProps) {
  const { t } = useTranslation('setlists')
  const { set, rows } = page
  const rowTitle = (item: SetlistItem): string => {
    if (item.item_type === 'song') return item.title?.toUpperCase() || t($ => $.item.unknownSong)
    return item.label || (item.item_type === 'pause' ? t($ => $.item.pause) : t($ => $.item.break))
  }
  return (
    <>
      <div style={{ fontWeight: 700, fontSize: '1.4em', marginBottom: '0.6em' }}>
        {set.name}
      </div>

      {rows.length === 0 ? (
        <div style={{ fontStyle: 'italic', opacity: 0.6 }}>{t($ => $.preview.noSongs)}</div>
      ) : (
        rows.map(({ item, order }) => {
          const isSong = item.item_type === 'song'
          return (
            <Fragment key={String(item.id)}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75em', padding: '0.12em 0' }}>
                <span style={{ minWidth: '1.6em', textAlign: 'right', fontWeight: 700 }}>
                  {isSong ? `${order}.` : ''}
                </span>
                <span style={{ flexGrow: 1, fontWeight: isSong ? 600 : 400, fontStyle: isSong ? 'normal' : 'italic', fontSize: isSong ? '1.5em' : undefined }}>
                  {rowTitle(item)}
                </span>
                {isSong && showKey && item.song_key ? (
                  <span style={{ minWidth: '3em', textAlign: 'right' }}>{item.song_key}</span>
                ) : null}
                {isSong && showBpm && item.tempo ? (
                  <span style={{ minWidth: '4.5em', textAlign: 'right' }}>{t($ => $.item.bpm, { tempo: item.tempo })}</span>
                ) : null}
                {!isSong && formatDuration(item.duration_seconds) ? (
                  <span style={{ minWidth: '4.5em', textAlign: 'right' }}>{formatDuration(item.duration_seconds)}</span>
                ) : null}
              </div>
              {isSong && item.linked_to_next ? (
                <div style={{ marginLeft: '2.35em', fontStyle: 'italic', opacity: 0.7, fontSize: '0.85em' }}>
                  ↳ {item.transition_note || t($ => $.preview.segueFallback)}
                </div>
              ) : null}
              {isSong && showNotes && item.my_note ? (
                <div style={{ marginLeft: '2.35em', fontStyle: 'italic', opacity: 0.7, fontSize: '0.85em' }}>
                  ✎ {item.my_note}
                </div>
              ) : null}
            </Fragment>
          )
        })
      )}
    </>
  )
}

interface SetlistPreviewModalProps {
  open: boolean
  onClose: () => void
  setlistName?: string
  sets?: SetlistSet[]
}

export default function SetlistPreviewModal({ open, onClose, setlistName = '', sets = [] }: SetlistPreviewModalProps) {
  const { t } = useTranslation(['setlists', 'common'])
  const [showKey, setShowKey] = useState(true)
  const [showBpm, setShowBpm] = useState(true)
  const [showNotes, setShowNotes] = useState(false)
  const [showPauseAndBreaks, setShowPauseAndBreaks] = useState(false)
  const pages = buildPages(sets, showPauseAndBreaks)

  const previewFrameStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: A4_WIDTH_PX,
    aspectRatio: `${A4_WIDTH_PX} / ${A4_HEIGHT_PX}`,
    marginLeft: 'auto',
    marginRight: 'auto',
    marginBottom: 24,
    background: '#fff',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
    containerType: 'inline-size',
    overflow: 'hidden',
  }
  const previewPadding = `${(A4_PADDING_PX / A4_WIDTH_PX) * 100}cqw`

  return (
    <>
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{setlistName || t($ => $.preview.fallbackTitle)}</DialogTitle>

      <DialogContent dividers sx={{ bgcolor: 'grey.200', overflowX: 'hidden' }}>
        <Box sx={{ width: '100%', minWidth: 0 }}>
          {pages.map((page) => (
            <div
              key={String(page.set.id)}
              data-testid="setlist-preview-frame"
              style={previewFrameStyle}
            >
              <div
                data-testid="setlist-preview-page"
                style={{
                  width: '100%',
                  height: '100%',
                  boxSizing: 'border-box',
                  padding: previewPadding,
                  background: '#fff',
                  color: '#000',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  fontSize: `${(pageFontSize(page.rows.length) / A4_WIDTH_PX) * 100}cqw`,
                }}
              >
                <PageContent
                  page={page}
                  showKey={showKey}
                  showBpm={showBpm}
                  showNotes={showNotes}
                />
              </div>
            </div>
          ))}
        </Box>
      </DialogContent>


      <DialogActions sx={{ px: 3, py: 1.5 }}>
        {/* On mobile (<600px) stack into rows: [Key + BPM], [Pauses & Breaks],
            then [Close + Print]. On sm+ everything sits on a single row. */}
        <Box
          sx={{
            width: '100%',
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            alignItems: { sm: 'center' },
            justifyContent: { sm: 'space-between' },
            gap: 1,
          }}
        >
          <Box
            sx={{
              display: 'flex',
              flexDirection: { xs: 'column', sm: 'row' },
              alignItems: { sm: 'center' },
              gap: { xs: 0.5, sm: 1 },
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <FormControlLabel
                control={<Switch checked={showKey} onChange={(e) => setShowKey(e.target.checked)} />}
                label={t($ => $.preview.showKey)}
              />
              <FormControlLabel
                control={<Switch checked={showBpm} onChange={(e) => setShowBpm(e.target.checked)} />}
                label={t($ => $.preview.showBpm)}
              />
              <FormControlLabel
                control={<Switch checked={showNotes} onChange={(e) => setShowNotes(e.target.checked)} />}
                label={t($ => $.preview.showNotes)}
              />
            </Box>
            <FormControlLabel
              control={<Switch checked={showPauseAndBreaks} onChange={(e) => setShowPauseAndBreaks(e.target.checked)} />}
              label={t($ => $.preview.showPausesBreaks)}
            />
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button onClick={onClose} sx={{ flexGrow: { xs: 1, sm: 0 } }}>{t($ => $.common.actions.close)}</Button>
            <Button
              variant="contained"
              startIcon={<PrintIcon />}
              onClick={() => globalThis.print()}
              sx={{ flexGrow: { xs: 1, sm: 0 } }}
            >
              {t($ => $.preview.print)}
            </Button>
          </Box>
        </Box>
      </DialogActions>
    </Dialog>

    {/* Hidden print surface, a sibling of the Dialog so MUI's own modal portal
        doesn't manage its lifecycle. Mounted only while open so it doesn't leak
        DOM nodes; the inline display:none keeps it out of normal flow and the
        @media print rules in index.css reveal it and paginate per set. */}
    {open && ReactDOM.createPortal(
        <div id="setlist-print-portal" style={{ display: 'none' }}>
          {pages.map((page) => (
            <div
              key={String(page.set.id)}
              className="setlist-print-page"
              style={{ display: 'flex', flexDirection: 'column', fontSize: `${pageFontSize(page.rows.length)}px` }}
            >
              <PageContent
                page={page}
                showKey={showKey}
                showBpm={showBpm}
                showNotes={showNotes}
              />
            </div>
          ))}
      </div>,
      document.body,
    )}
    </>
  )
}
