import Typography from '@mui/material/Typography'

const LABELS = { idle: '', saving: 'Saving…', saved: 'Saved', error: 'Save failed' }

export default function SaveStatusLabel({ status, sx }) {
  const label = LABELS[status] ?? ''
  const color = status === 'error' ? 'error.main' : 'text.secondary'
  return (
    <Typography variant="caption" color={color} sx={sx}>
      {label}
    </Typography>
  )
}
