import InputAdornment from '@mui/material/InputAdornment'
import CopyIconButton from './CopyIconButton.jsx'

export default function CopyAdornment({ value }) {
  if (!value) return null
  return (
    <InputAdornment position="end">
      <CopyIconButton value={value} edge="end" />
    </InputAdornment>
  )
}
