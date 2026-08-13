import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import Link from '@mui/material/Link'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Typography from '@mui/material/Typography'
import LibraryMusicIcon from '@mui/icons-material/LibraryMusic'
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf'
import { getSong } from '../../songs/songs.ts'
import type { SetlistItem, SetlistItemPatch, Song, Id } from '../../../types/entities.ts'

// Picks what performance mode shows for one song in one setlist: a ChordPro
// chart or a PDF document already attached to that song. Charts are only exposed
// embedded in the song read, so the whole song is fetched when the dialog opens.
interface SetlistItemSourcePickerProps {
  open: boolean
  item: SetlistItem
  onClose: () => void
  onSelect: (patch: SetlistItemPatch) => void
}

// The radio value encodes kind + id in one string so a chart and a document that
// happen to share a numeric id stay distinguishable.
const NONE = 'none'
const optionValue = (kind: 'chart' | 'document', id: Id) => `${kind}:${id}`

function patchFor(value: string): SetlistItemPatch {
  if (value === NONE) return { chart_id: null }
  const [kind, rawId] = value.split(':')
  const id = Number(rawId)
  return kind === 'chart' ? { chart_id: id } : { document_id: id }
}

function currentValue(item: SetlistItem): string {
  if (item.chart_id) return optionValue('chart', item.chart_id)
  if (item.document_id) return optionValue('document', item.document_id)
  return NONE
}

export default function SetlistItemSourcePicker({
  open,
  item,
  onClose,
  onSelect,
}: Readonly<SetlistItemSourcePickerProps>) {
  const { t } = useTranslation(['setlists', 'common'])
  const [song, setSong] = useState<Song | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const songId = item.song_id

  // The parent mounts this only while open, so one fetch per opening.
  useEffect(() => {
    if (!open || !songId) return
    let active = true
    getSong(songId)
      .then((loaded) => { if (active) setSong(loaded) })
      .catch(() => { if (active) setFailed(true) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open, songId])

  const charts = song?.chordpro_charts ?? []
  const documents = song?.documents ?? []
  const hasOptions = charts.length > 0 || documents.length > 0

  function handleChange(value: string) {
    onSelect(patchFor(value))
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t($ => $.item.source.title)}</DialogTitle>
      <DialogContent dividers>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={28} />
          </Box>
        )}
        {failed && <Alert severity="error">{t($ => $.item.source.loadFailed)}</Alert>}
        {!loading && !failed && !hasOptions && (
          <Typography variant="body2" color="text.secondary">
            {t($ => $.item.source.empty)}{' '}
            <Link component={RouterLink} to={`/songs/${songId}`}>
              {t($ => $.item.source.emptyLink)}
            </Link>
          </Typography>
        )}
        {!loading && !failed && hasOptions && (
          <RadioGroup
            value={currentValue(item)}
            onChange={(e) => handleChange(e.target.value)}
          >
            <FormControlLabel value={NONE} control={<Radio />} label={t($ => $.item.source.none)} />
            {charts.map((chart) => (
              <FormControlLabel
                key={`chart-${chart.id}`}
                value={optionValue('chart', chart.id!)}
                control={<Radio />}
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <LibraryMusicIcon fontSize="small" color="action" />
                    {chart.name || t($ => $.item.source.untitledChart)}
                  </Box>
                }
              />
            ))}
            {documents.map((doc) => (
              <FormControlLabel
                key={`document-${doc.id}`}
                value={optionValue('document', doc.id!)}
                control={<Radio />}
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <PictureAsPdfIcon fontSize="small" color="action" />
                    {doc.original_filename}
                  </Box>
                }
              />
            ))}
          </RadioGroup>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t($ => $.common.actions.close)}</Button>
      </DialogActions>
    </Dialog>
  )
}
