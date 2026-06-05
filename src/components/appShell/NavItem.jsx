import PropTypes from 'prop-types'
import { NavLink } from 'react-router-dom'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Tooltip from '@mui/material/Tooltip'
import { alpha } from '@mui/material/styles'
import { isItemSelected } from './navSelection.js'

export default function NavItem({ item, pathname, isNavCollapsed, indent, rail, onClick }) {
  const selected = isItemSelected(item.to, pathname)
  const Icon = item.icon
  return (
    <Tooltip
      title={isNavCollapsed ? item.label : ''}
      placement="right"
      disableHoverListener={!isNavCollapsed}
      slotProps={{
        popper: { modifiers: [{ name: 'offset', options: { offset: [0, -20] } }] },
        tooltip: {
          sx: {
            m: 0,
            bgcolor: 'background.paper',
            color: 'text.primary',
            boxShadow: 3,
            borderRadius: 1,
            px: 1.5,
            py: 0.75,
            fontSize: '0.8125rem',
          },
        },
      }}
    >
      <ListItemButton
        component={NavLink}
        to={item.to}
        selected={selected}
        onClick={onClick}
        aria-label={isNavCollapsed ? item.label : undefined}
        sx={{
          position: 'relative',
          justifyContent: isNavCollapsed ? 'center' : 'flex-start',
          minHeight: 44,
          px: isNavCollapsed ? 1.5 : 2,
          ...(indent && !isNavCollapsed ? { pl: 3.5 } : {}),
          // Active child sits one shade stronger than its selected group header.
          '&.Mui-selected': {
            bgcolor: (t) => alpha(t.palette.primary.main, 0.16),
            '&:hover': { bgcolor: (t) => alpha(t.palette.primary.main, 0.22) },
          },
          // Continuous left rail down an expanded group: a subtle full-height
          // segment per item, turning the accent colour only for the active one.
          ...(rail
            ? {
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 3,
                  backgroundColor: (t) =>
                    selected
                      ? t.palette.primary.main
                      : t.palette.mode === 'light'
                        ? t.palette.grey[500]
                        : t.palette.grey[400],
                },
              }
            : {}),
        }}
      >
        <ListItemIcon sx={{ minWidth: isNavCollapsed ? 0 : 36, justifyContent: 'center' }}>
          <Icon fontSize="small" color={selected ? 'primary' : 'inherit'} />
        </ListItemIcon>
        {!isNavCollapsed && <ListItemText primary={item.label} sx={{ ml: 1.5 }} />}
      </ListItemButton>
    </Tooltip>
  )
}

NavItem.propTypes = {
  item: PropTypes.shape({
    to: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
    icon: PropTypes.elementType.isRequired,
  }).isRequired,
  pathname: PropTypes.string.isRequired,
  isNavCollapsed: PropTypes.bool,
  indent: PropTypes.bool,
  rail: PropTypes.bool,
  onClick: PropTypes.func,
}
