import type { Gig } from '../types/entities.ts'
import { useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Snackbar from '@mui/material/Snackbar'
import Typography from '@mui/material/Typography'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { venueHeadline, venueCity } from '../utils/venueDisplay.ts'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function exportDate(val?: string | Date): string {
  if (!val) return '—'
  const d = new Date(val)
  return `${MONTHS[d.getUTCMonth()]}-${String(d.getUTCDate()).padStart(2, '0')}`
}

interface TourExportDialogProps {
  open: boolean
  onClose: () => void
  gigs?: Gig[]
}

export default function TourExportDialog({ open, onClose, gigs = [] }: TourExportDialogProps) {
  const [snackbar, setSnackbar] = useState(false)

  const text = useMemo(
    () =>
      gigs
        .map((g) => [exportDate(g.event_date), venueHeadline(g.venue ?? g.festival), venueCity(g.venue ?? g.festival)].join('\t'))
        .join('\n'),
    [gigs],
  )

  async function handleCopy() {
    await navigator.clipboard.writeText(text)
    setSnackbar(true)
  }

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="sm"
        fullWidth
        onClick={(e) => e.stopPropagation()}
      >
        <DialogTitle>Export tour dates</DialogTitle>
        <DialogContent dividers>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            Tab-separated table — paste directly into Figma, Notion, or any design tool.
          </Typography>
          <Box
            component="pre"
            sx={{
              fontFamily: 'monospace',
              fontSize: '0.8125rem',
              bgcolor: 'action.hover',
              borderRadius: 1,
              p: 1.5,
              m: 0,
              overflowX: 'auto',
              whiteSpace: 'pre',
              userSelect: 'all',
              minHeight: 48,
              color: gigs.length ? 'text.primary' : 'text.secondary',
            }}
          >
            {text || 'No gigs to export.'}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Close</Button>
          <Button
            variant="contained"
            startIcon={<ContentCopyIcon />}
            onClick={handleCopy}
            disabled={!text}
          >
            Copy
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar}
        autoHideDuration={3000}
        onClose={() => setSnackbar(false)}
        message="Copied to clipboard"
      />
    </>
  )
}
