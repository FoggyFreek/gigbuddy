import Box from '@mui/material/Box'
import Tooltip from '@mui/material/Tooltip'

// A small coloured dot indicating a status. `color` is an MUI palette key
// (e.g. 'success', 'primary', 'warning'); unknown keys such as 'default' fall
// back to a muted disabled tone. Pass `label` to show it in a tooltip.

interface StatusDotProps {
  color?: string
  label?: string
  size?: number
}

export default function StatusDot({ color = 'default', label, size = 12 }: StatusDotProps) {
  const dot = (
    <Box
      component="span"
      sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        bgcolor: (t) => ((t.palette as unknown) as Record<string, { main?: string }>)[color]?.main ?? t.palette.action.disabled,
        display: 'inline-block',
        flexShrink: 0,
      }}
    />
  )
  if (!label) return dot
  return (
    <Tooltip title={label} arrow>
      {dot}
    </Tooltip>
  )
}
