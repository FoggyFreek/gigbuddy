import InputAdornment from '@mui/material/InputAdornment'
import CopyIconButton from './CopyIconButton.tsx'

interface CopyAdornmentProps {
  value?: string
}

export default function CopyAdornment({ value }: CopyAdornmentProps) {
  if (!value) return null
  return (
    <InputAdornment position="end">
      <CopyIconButton value={value} edge="end" />
    </InputAdornment>
  )
}
