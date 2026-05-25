import PropTypes from 'prop-types'
import { NavLink } from 'react-router-dom'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Tooltip from '@mui/material/Tooltip'

export default function NavItem({ item, pathname, isNavCollapsed, onClick }) {
  const selected = item.to === '/' ? pathname === '/' : pathname.startsWith(item.to)
  const Icon = item.icon
  return (
    <Tooltip
      title={isNavCollapsed ? item.label : ''}
      placement="right"
      disableHoverListener={!isNavCollapsed}
    >
      <ListItemButton
        component={NavLink}
        to={item.to}
        selected={selected}
        onClick={onClick}
        sx={{
          justifyContent: isNavCollapsed ? 'center' : 'flex-start',
          minHeight: 48,
          px: isNavCollapsed ? 1.5 : 2,
        }}
      >
        <ListItemIcon sx={{ minWidth: isNavCollapsed ? 0 : 36, justifyContent: 'center' }}>
          <Icon color={selected ? 'primary' : 'inherit'} />
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
  onClick: PropTypes.func,
}
