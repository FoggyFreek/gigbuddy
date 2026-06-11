import Box from '@mui/material/Box'
import Tooltip from '@mui/material/Tooltip'
import PropTypes from 'prop-types'

// A small coloured dot indicating a status. `color` is an MUI palette key
// (e.g. 'success', 'primary', 'warning'); unknown keys such as 'default' fall
// back to a muted disabled tone. Pass `label` to show it in a tooltip.
export default function StatusDot({ color = 'default', label, size = 12 }) {
  const dot = (
    <Box
      component="span"
      sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        bgcolor: (t) => t.palette[color]?.main ?? t.palette.action.disabled,
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

StatusDot.propTypes = {
  color: PropTypes.string,
  label: PropTypes.string,
  size: PropTypes.number,
}
