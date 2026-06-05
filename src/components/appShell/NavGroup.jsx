import PropTypes from 'prop-types'
import { NavLink } from 'react-router-dom'
import Box from '@mui/material/Box'
import Collapse from '@mui/material/Collapse'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { alpha } from '@mui/material/styles'
import NavItem from './NavItem.jsx'
import { isItemSelected } from './navSelection.js'

// Selected group header sits one shade *below* its active child (see NavItem).
const groupSelectedSx = {
  '&.Mui-selected': {
    bgcolor: (t) => alpha(t.palette.primary.main, 0.08),
    '&:hover': { bgcolor: (t) => alpha(t.palette.primary.main, 0.12) },
  },
}

// Rich flyout shown when hovering a collapsed group icon: title + clickable
// child links so the icon rail stays fully navigable.
function CollapsedFlyout({ group, pathname, onNavClick }) {
  return (
    <Box sx={{ py: 0.5, minWidth: 160 }}>
      <Typography variant="subtitle2" sx={{ px: 1.5, py: 0.5 }}>
        {group.label}
      </Typography>
      <List dense disablePadding>
        {group.children.map((child) => {
          const Icon = child.icon
          return (
            <ListItemButton
              key={child.to}
              component={NavLink}
              to={child.to}
              onClick={onNavClick}
              selected={isItemSelected(child.to, pathname)}
              sx={{ borderRadius: 1, mx: 0.5 }}
            >
              <ListItemIcon sx={{ minWidth: 32 }}>
                <Icon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary={child.label} />
            </ListItemButton>
          )
        })}
      </List>
    </Box>
  )
}

CollapsedFlyout.propTypes = {
  group: PropTypes.object.isRequired,
  pathname: PropTypes.string.isRequired,
  onNavClick: PropTypes.func,
}

export default function NavGroup({ group, pathname, isNavCollapsed, expanded, onToggle, onNavClick }) {
  const GroupIcon = group.icon
  const groupSelected = group.children.some((c) => isItemSelected(c.to, pathname))

  const header = (
    <ListItemButton
      onClick={() => onToggle(group.key)}
      selected={groupSelected}
      aria-label={`${group.label} group`}
      aria-expanded={isNavCollapsed ? undefined : expanded}
      sx={{
        position: 'relative',
        justifyContent: isNavCollapsed ? 'center' : 'flex-start',
        minHeight: 48,
        px: isNavCollapsed ? 1.5 : 2,
        ...groupSelectedSx,
        // Top of the expanded group's left rail (always the subtle shade — the
        // accent colour is reserved for the selected child).
        ...(expanded
          ? {
              '&::before': {
                content: '""',
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: 3,
                bgcolor: 'divider',
              },
            }
          : {}),
      }}
    >
      <ListItemIcon sx={{ minWidth: isNavCollapsed ? 0 : 36, justifyContent: 'center' }}>
        <GroupIcon color={groupSelected ? 'primary' : 'inherit'} />
      </ListItemIcon>
      {!isNavCollapsed && (
        <ListItemText primary={group.label} sx={{ ml: 1.5 }} slotProps={{ primary: { fontWeight: 600 } }} />
      )}
    </ListItemButton>
  )

  if (isNavCollapsed) {
    // Icon rail: group icon (with hover flyout) and, only for the expanded
    // group, its child icons beneath it.
    return (
      <>
        <Tooltip
          // Once expanded the child icons are already visible, so skip the
          // redundant hover flyout (empty title = no tooltip).
          title={expanded ? '' : <CollapsedFlyout group={group} pathname={pathname} onNavClick={onNavClick} />}
          // Anchor to the top of the group icon and butt right up against it,
          // with square corners.
          placement="right-start"
          slotProps={{
            popper: { modifiers: [{ name: 'offset', options: { offset: [0, 0] } }] },
            tooltip: { sx: { m: 0, p: 0, borderRadius: 0 } },
          }}
        >
          {header}
        </Tooltip>
        {expanded &&
          group.children.map((child) => (
            <NavItem
              key={child.to}
              item={child}
              pathname={pathname}
              isNavCollapsed
              rail
              onClick={onNavClick}
            />
          ))}
      </>
    )
  }

  return (
    <>
      {header}
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <List disablePadding>
          {group.children.map((child) => (
            <NavItem
              key={child.to}
              item={child}
              pathname={pathname}
              indent
              rail
              onClick={onNavClick}
            />
          ))}
        </List>
      </Collapse>
    </>
  )
}

NavGroup.propTypes = {
  group: PropTypes.shape({
    key: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
    icon: PropTypes.elementType.isRequired,
    children: PropTypes.arrayOf(
      PropTypes.shape({
        to: PropTypes.string.isRequired,
        label: PropTypes.string.isRequired,
        icon: PropTypes.elementType.isRequired,
      }),
    ).isRequired,
  }).isRequired,
  pathname: PropTypes.string.isRequired,
  isNavCollapsed: PropTypes.bool,
  expanded: PropTypes.bool,
  onToggle: PropTypes.func.isRequired,
  onNavClick: PropTypes.func,
}
