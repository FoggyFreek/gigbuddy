import type { SxProps, Theme } from '@mui/material/styles'
import Typography from '@mui/material/Typography'

const LABELS: Record<string, string> = { idle: '', saving: 'Saving…', saved: 'Saved', error: 'Save failed' }

interface SaveStatusLabelProps {
  status?: string
  sx?: SxProps<Theme>
}

export default function SaveStatusLabel({ status, sx }: SaveStatusLabelProps) {
  const label = (status && LABELS[status]) ?? ''
  const color = status === 'error' ? 'error.main' : 'text.secondary'
  return (
    <Typography variant="caption" color={color} sx={sx}>
      {label}
    </Typography>
  )
}
