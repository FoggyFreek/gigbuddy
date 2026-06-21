import { useCallback, useEffect, useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import CircularProgress from '@mui/material/CircularProgress'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CheckIcon from '@mui/icons-material/Check'
import RefreshIcon from '@mui/icons-material/Refresh'
import {
  getCalendarFeed,
  regenerateCalendarFeed,
  deleteCalendarFeed,
  type CalendarFeed,
} from '../../api/calendarFeed.ts'

interface CalendarFeedDialogProps {
  open: boolean
  onClose: () => void
}

export default function CalendarFeedDialog({ open, onClose }: CalendarFeedDialogProps) {
  const [feed, setFeed] = useState<CalendarFeed | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setCopied(false)
      setFeed(await getCalendarFeed())
    } catch {
      setFeed(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  function handleGenerate() {
    setBusy(true)
    regenerateCalendarFeed()
      .then(setFeed)
      .catch(() => {})
      .finally(() => setBusy(false))
  }

  function handleDisable() {
    setBusy(true)
    deleteCalendarFeed()
      .then(() => setFeed(null))
      .catch(() => {})
      .finally(() => setBusy(false))
  }

  function handleCopy() {
    if (!feed) return
    navigator.clipboard.writeText(feed.url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Subscribe to calendar</DialogTitle>
      <DialogContent>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
          Keep your own calendar in sync with the band calendar.
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Copy the link below and add it to Google Calendar, Apple Calendar or Outlook as a subscribed calendar
          (&ldquo;From URL&rdquo;).
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 2 }}>
          This link is personal — don&rsquo;t share it.
        </Typography>

        {(() => {
          if (loading) {
            return (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                <CircularProgress size={28} />
              </Box>
            )
          }
          if (feed) {
            return (
              <>
                <Box sx={{ display: 'flex', alignItems: 'center', mt: 2, gap: 1 }}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Calendar feed URL"
                    value={feed.url}
                    slotProps={{ htmlInput: { readOnly: true } }}
                    onFocus={(e) => e.target.select()}
                  />
                  <Tooltip title={copied ? 'Copied!' : 'Copy link'}>
                    <IconButton onClick={handleCopy} aria-label="copy calendar feed url">
                      {copied ? <CheckIcon /> : <ContentCopyIcon />}
                    </IconButton>
                  </Tooltip>
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
                  Regenerating creates a new link and breaks any calendar still using the old
                  one. Disabling stops the feed completely.
                </Typography>
              </>
            )
          }
          return (
            <Typography variant="body2">
              No calendar feed yet. Generate a personal subscribe link to get started.
            </Typography>
          )
        })()}
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap' }}>
        {feed && (
          <Button color="error" onClick={handleDisable} disabled={busy}>
            Disable feed
          </Button>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Button onClick={onClose}>Close</Button>
        <Button
          variant="contained"
          onClick={handleGenerate}
          disabled={busy}
          startIcon={feed ? <RefreshIcon /> : undefined}
        >
          {feed ? 'Regenerate link' : 'Generate link'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
