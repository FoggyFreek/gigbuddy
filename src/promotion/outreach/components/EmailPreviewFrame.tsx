import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'

interface Props {
  html: string
  subject?: string
  loading?: boolean
  title: string
  minHeight?: number
}

// Renders merged email HTML in a sandboxed iframe. Sanitizing is the caller's
// job — it happens once, next to whatever produced the HTML — but the sandbox
// stays here so every preview surface gets it.
export default function EmailPreviewFrame({ html, subject, loading, title, minHeight = 320 }: Readonly<Props>) {
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight }}>
        <CircularProgress />
      </Box>
    )
  }
  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
      {subject !== undefined && (
        <Box sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{subject}</Typography>
        </Box>
      )}
      <Box
        component="iframe"
        title={title}
        srcDoc={html}
        sandbox=""
        sx={{ width: '100%', minHeight, border: 0, display: 'block', backgroundColor: '#ffffff' }}
      />
    </Paper>
  )
}
