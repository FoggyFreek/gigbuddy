import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControl from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormLabel from '@mui/material/FormLabel'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import { getPlaceDetails, searchPlaces } from '../../api/places.ts'
import { pickFillableUpdates } from '../../utils/placeFill.ts'
import type { PlaceSuggestion } from '../../types/api.ts'

export interface PlaceEnrichField {
  key: string
  label: string
}

interface PlaceEnrichDialogProps {
  /** Text to look up — typically the record's name. */
  query: string
  /** The record as it stands; decides which fields count as empty. */
  current: Record<string, unknown>
  /** Which fields to offer, in display order, with their translated labels. */
  fields: PlaceEnrichField[]
  onApply: (suggestion: PlaceSuggestion) => Promise<void> | void
  onClose: () => void
  title?: string
}

// Reusable "look up and fill the blanks" dialog: pick a candidate place, preview
// exactly which empty fields it would fill, then confirm. Resource-agnostic — the
// caller supplies the field descriptors and owns the write.
//
// The preview is UX only. The server recomputes the fill set against the stored
// row, so what it actually writes is authoritative.
export default function PlaceEnrichDialog({
  query, current, fields, onApply, onClose, title,
}: Readonly<PlaceEnrichDialogProps>) {
  const { t } = useTranslation(['places', 'common'])
  const [candidates, setCandidates] = useState<PlaceSuggestion[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [applying, setApplying] = useState(false)
  const [resolving, setResolving] = useState(false)
  const sessionId = useRef(crypto.randomUUID()).current

  useEffect(() => {
    let active = true
    setLoading(true)
    setFailed(false)
    setCandidates([])
    searchPlaces(query, { sessionId })
      .then((items) => {
        if (!active) return
        setCandidates(items)
        setSelectedIndex(0)
      })
      .catch(() => { if (active) setFailed(true) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [query, sessionId])

  const selected = candidates[selectedIndex] ?? null

  useEffect(() => {
    if (!selected?.details) return
    let active = true
    setResolving(true)
    getPlaceDetails(selected)
      .then((details) => {
        if (!active) return
        setCandidates((current) => current.map((candidate, index) => (
          index === selectedIndex ? details : candidate
        )))
      })
      .catch(() => { if (active) setFailed(true) })
      .finally(() => { if (active) setResolving(false) })
    return () => { active = false }
  }, [selected, selectedIndex])

  const fieldKeys = useMemo(() => fields.map((f) => f.key), [fields])
  const updates = useMemo(
    () => (selected ? pickFillableUpdates(current, selected, fieldKeys) : {}),
    [current, selected, fieldKeys],
  )
  const fillable = fields.filter((f) => f.key in updates)

  async function handleApply() {
    if (!selected) return
    setApplying(true)
    try {
      await onApply(selected)
    } finally {
      setApplying(false)
    }
  }

  function renderBody() {
    if (loading || resolving) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      )
    }
    if (failed) return <Alert severity="error">{t($ => $.enrich.failed)}</Alert>
    if (!candidates.length) {
      return <Alert severity="info">{t($ => $.enrich.noCandidates, { query })}</Alert>
    }

    return (
      <>
        <FormControl sx={{ width: '100%' }}>
          <FormLabel id="place-enrich-candidates">{t($ => $.enrich.candidatesHeading)}</FormLabel>
          <RadioGroup
            aria-labelledby="place-enrich-candidates"
            value={String(selectedIndex)}
            onChange={(e) => setSelectedIndex(Number(e.target.value))}
            sx={{ mt: 1 }}
          >
            {candidates.map((candidate, index) => (
              <FormControlLabel
                key={candidate.id ?? `${candidate.name}-${index}`}
                value={String(index)}
                control={<Radio size="small" />}
                sx={{ alignItems: 'flex-start', mb: 0.5, '& .MuiRadio-root': { pt: 0.5 } }}
                label={(
                  <Box>
                    <Typography variant="body2">{candidate.name}</Typography>
                    {candidate.freeform_address && (
                      <Typography variant="caption" color="text.secondary">
                        {candidate.freeform_address}
                      </Typography>
                    )}
                  </Box>
                )}
              />
            ))}
          </RadioGroup>
        </FormControl>

        <Box sx={{ mt: 2 }}>
          {fillable.length === 0 ? (
            <Alert severity="info">{t($ => $.enrich.nothingToFill)}</Alert>
          ) : (
            <>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                {t($ => $.enrich.willFill, { count: fillable.length })}
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t($ => $.enrich.fieldColumn)}</TableCell>
                    <TableCell>{t($ => $.enrich.valueColumn)}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {fillable.map((field) => (
                    <TableRow key={field.key}>
                      <TableCell sx={{ color: 'text.secondary' }}>{field.label}</TableCell>
                      <TableCell>{String(updates[field.key])}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                {t($ => $.enrich.untouchedNote)}
              </Typography>
            </>
          )}
        </Box>
      </>
    )
  }

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle>{title ?? t($ => $.enrich.title)}</DialogTitle>
      <DialogContent>{renderBody()}</DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>{t($ => $.common.actions.cancel)}</Button>
        <Button
          variant="contained"
          disabled={!fillable.length || applying}
          onClick={handleApply}
        >
          {t($ => $.enrich.apply, { count: fillable.length })}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
