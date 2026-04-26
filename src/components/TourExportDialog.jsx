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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function exportDate(val) {
  if (!val) return '—'
  const d = new Date(val)
  return `${MONTHS[d.getUTCMonth()]}-${String(d.getUTCDate()).padStart(2, '0')}`
}

export default function TourExportDialog({ open, onClose, gigs = [] }) {
  const [snackbar, setSnackbar] = useState(false)

  const text = useMemo(
    () =>
      gigs
        .map((g) => [exportDate(g.event_date), g.venue || '', g.city || ''].join('\t'))
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
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
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
