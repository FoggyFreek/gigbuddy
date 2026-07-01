import { NavLink } from 'react-router-dom'
import Box from '@mui/material/Box'
import Collapse from '@mui/material/Collapse'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { alpha, darken, lighten } from '@mui/material/styles'
import type { Theme } from '@mui/material/styles'
import type { SvgIconComponent } from '@mui/icons-material'
import NavItem from './NavItem.tsx'
import { isItemSelected } from './navSelection.ts'

// Selected group header sits one shade *below* its active child (see NavItem).
const groupSelectedSx = {
  '&.Mui-selected': {
    bgcolor: (t: Theme) => alpha(t.palette.primary.main, 0.08),
    '&:hover': { bgcolor: (t: Theme) => alpha(t.palette.primary.main, 0.12) },
  },
}

interface NavChildDef {
  to: string
  label: string
  icon: SvgIconComponent
}

interface NavGroupDef {
  key: string
  label: string
  icon: SvgIconComponent
  children: NavChildDef[]
}

interface CollapsedFlyoutProps {
  group: NavGroupDef
  pathname: string
  onNavClick?: () => void
}

// Rich flyout shown when hovering a collapsed group icon: title + clickable
// child links so the icon rail stays fully navigable.
function CollapsedFlyout({ group, pathname, onNavClick }: Readonly<CollapsedFlyoutProps>) {
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

interface NavGroupProps {
  group: NavGroupDef
  // Pre-translated accessible name for the header button (e.g. "Planning group").
  // Built by the caller so this component stays free of i18n wiring.
  ariaLabel: string
  pathname: string
  isNavCollapsed?: boolean
  expanded?: boolean
  onToggle: (key: string) => void
  onNavClick?: () => void
}

export default function NavGroup({ group, ariaLabel, pathname, isNavCollapsed, expanded, onToggle, onNavClick }: Readonly<NavGroupProps>) {
  const GroupIcon = group.icon
  const groupSelected = group.children.some((c) => isItemSelected(c.to, pathname))

  const header = (
    <ListItemButton
      onClick={() => onToggle(group.key)}
      selected={groupSelected}
      aria-label={ariaLabel}
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
                backgroundColor: (t: Theme) =>
                  t.palette.mode === 'light'
                    ? darken(t.palette.background.paper, 0.12)
                    : lighten(t.palette.background.paper, 0.14),
              },
            }
          : {}),
      }}
    >
      <ListItemIcon sx={{ minWidth: isNavCollapsed ? 0 : 36, justifyContent: 'center' }}>
        <GroupIcon color={groupSelected ? 'primary' : 'inherit'} />
      </ListItemIcon>
      {!isNavCollapsed && (
        // slotProps.primary expects TypographyProps; sx is valid there but the
        // generic infers a strict span-variant type — cast to satisfy tsc.
        <ListItemText
          primary={group.label}
          sx={{ ml: 1.5, '& .MuiListItemText-primary': { fontWeight: 600 } }}
        />
      )}
    </ListItemButton>
  )

  const expandedBg = expanded
    ? {
        bgcolor: (t: Theme) =>
          t.palette.mode === 'light'
            ? darken(t.palette.background.paper, 0.04)
            : lighten(t.palette.background.paper, 0.06),
      }
    : {}

  if (isNavCollapsed) {
    // Icon rail: group icon (with hover flyout) and, only for the expanded
    // group, its child icons beneath it.
    return (
      <Box sx={expandedBg}>
        <Tooltip
          // Once expanded the child icons are already visible, so skip the
          // redundant hover flyout (empty title = no tooltip).
          title={expanded ? '' : <CollapsedFlyout group={group} pathname={pathname} onNavClick={onNavClick} />}
          // Anchor to the top of the group icon and butt right up against it,
          // with square corners.
          placement="right-start"
          slotProps={{
            popper: { modifiers: [{ name: 'offset', options: { offset: [0, -14] } }] },
            tooltip: {
              sx: {
                m: 0,
                p: 0,
                bgcolor: 'background.paper',
                color: 'text.primary',
                boxShadow: 3,
                borderRadius: 0,
              },
            },
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
      </Box>
    )
  }

  return (
    <Box sx={expandedBg}>
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
    </Box>
  )
}
