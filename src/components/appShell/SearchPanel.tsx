import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Paper from '@mui/material/Paper'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import CloseIcon from '@mui/icons-material/Close'
import HistoryIcon from '@mui/icons-material/History'
import type { SvgIconComponent } from '@mui/icons-material'
import ContactsOutlined from '@mui/icons-material/ContactsOutlined'
import EventOutlined from '@mui/icons-material/EventOutlined'
import InsertDriveFileOutlined from '@mui/icons-material/InsertDriveFileOutlined'
import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined'
import ShoppingCartOutlined from '@mui/icons-material/ShoppingCartOutlined'
import LibraryMusicOutlined from '@mui/icons-material/LibraryMusicOutlined'
import QueueMusicOutlined from '@mui/icons-material/QueueMusicOutlined'
import StorefrontOutlined from '@mui/icons-material/StorefrontOutlined'
import PlaceOutlined from '@mui/icons-material/PlaceOutlined'
import ListAltOutlined from '@mui/icons-material/ListAltOutlined'
import { useRecentSearches } from '../../hooks/useRecentSearches.ts'
import { useSearchCategories } from '../../hooks/useSearchCategories.ts'
import { usePermissions } from '../../hooks/usePermissions.ts'
import {
  useCategorySearch,
  FINANCE_CATEGORY_KEYS,
  COLLAPSED_COUNT,
  EXPANDED_COUNT,
} from '../../hooks/useCategorySearch.ts'
import type { SearchResultItem } from '../../hooks/useCategorySearch.ts'
import { PERMISSIONS } from '../../auth/permissions.ts'
import type { Id } from '../../types/entities.ts'

interface SearchCategory {
  key: string
  label: string
  icon: SvgIconComponent
}

interface SearchPanelProps {
  query: string
  tenantId: Id | null
  onNavigate: () => void
}

// All searchable areas. The first three are active by default; the rest are
// added on demand from the "Add new" menu.
const ALL_CATEGORIES: SearchCategory[] = [
  { key: 'contacts', label: 'Contacts', icon: ContactsOutlined },
  { key: 'gigs', label: 'Gigs', icon: EventOutlined },
  { key: 'files', label: 'Files', icon: InsertDriveFileOutlined },
  { key: 'invoices', label: 'Invoices', icon: ReceiptLongOutlined },
  { key: 'purchases', label: 'Purchases', icon: ShoppingCartOutlined },
  { key: 'songs', label: 'Songs', icon: LibraryMusicOutlined },
  { key: 'setlists', label: 'Setlists', icon: QueueMusicOutlined },
  { key: 'suppliers', label: 'Suppliers', icon: StorefrontOutlined },
  { key: 'venues', label: 'Venues', icon: PlaceOutlined },
  { key: 'transaction', label: 'Transaction', icon: ListAltOutlined },
]

const DEFAULT_KEYS = ['contacts', 'gigs', 'files']
// Results list indents to line up with the category name: icon width + gap.
const RESULT_INDENT = '28px'

function CountCircle({ count }: { count: number }) {
  return (
    <Box
      sx={{
        minWidth: 20,
        height: 20,
        px: 0.75,
        borderRadius: '999px',
        bgcolor: 'action.selected',
        color: 'text.secondary',
        fontSize: 11,
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {count}
    </Box>
  )
}

function RecentRow({ item, onClick, onRemove }: {
  item: { category: string; label: string }
  onClick: () => void
  onRemove: () => void
}) {
  const Icon = ALL_CATEGORIES.find((c) => c.key === item.category)?.icon ?? ListAltOutlined
  return (
    <ListItem
      disablePadding
      secondaryAction={
        <IconButton
          edge="end"
          size="small"
          aria-label="remove recent search"
          onClick={(e) => { e.stopPropagation(); onRemove() }}
        >
          <CloseIcon sx={{ fontSize: 14 }} />
        </IconButton>
      }
    >
      <ListItemButton onClick={onClick} sx={{ borderRadius: 1, py: 0.25 }}>
        <ListItemIcon sx={{ minWidth: 32 }}>
          <Icon fontSize="small" sx={{ color: 'text.secondary' }} />
        </ListItemIcon>
        <ListItemText primary={item.label} slotProps={{ primary: { variant: 'body2', noWrap: true } }} />
      </ListItemButton>
    </ListItem>
  )
}

export default function SearchPanel({ query, tenantId, onNavigate }: SearchPanelProps) {
  const navigate = useNavigate()
  const { can } = usePermissions()
  const canViewFinance = can(PERMISSIONS.FINANCE_VIEW)
  const { recents, addRecent, removeRecent, clearRecents } = useRecentSearches(tenantId)
  const { activeKeys, addCategory: persistCategory, removeCategory } = useSearchCategories(tenantId, DEFAULT_KEYS)
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)

  // Hide finance categories from members without finance.view.
  const visibleCategories = ALL_CATEGORIES.filter(
    (c) => canViewFinance || !FINANCE_CATEGORY_KEYS.has(c.key),
  )
  const active = activeKeys
    .map((key) => visibleCategories.find((c) => c.key === key))
    .filter((c): c is SearchCategory => Boolean(c))
  const available = visibleCategories.filter((c) => !activeKeys.includes(c.key))

  const { results, expanded, expandCategory, hasQuery } = useCategorySearch(query, activeKeys, canViewFinance)

  const addCategory = (key: string) => {
    persistCategory(key)
    setMenuAnchor(null)
  }

  // Hide recents the moment the user starts typing (use the immediate query,
  // not the debounced one, so it disappears without the debounce lag).
  const showRecent = query.trim().length === 0 && recents.length > 0

  // Record the destination (not the query) before navigating, then close.
  const handleItemClick = (category: string, item: SearchResultItem) => {
    addRecent({ category, id: item.id, label: item.label, to: item.to })
    onNavigate()
    navigate(item.to)
  }

  const handleRecentClick = (item: { category: string; id: string; label: string; to: string }) => {
    addRecent({ category: item.category, id: item.id, label: item.label, to: item.to })
    onNavigate()
    navigate(item.to)
  }

  return (
    <Paper
      elevation={2}
      sx={{
        mt: 1,
        p: 1.5,
        borderBottomLeftRadius: 14,
        borderBottomRightRadius: 14,
        borderTopLeftRadius: 0,
        borderTopRightRadius: 0,
        display: 'flex',
        flexDirection: 'column',
        maxHeight: 'calc(100vh - 96px)',
      }}
    >
      {showRecent && (
        <Box sx={{ mb: 1.5, maxHeight: 280, overflowY: 'auto' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <HistoryIcon fontSize="small" sx={{ color: 'text.secondary' }} />
            <Typography variant="overline" color="text.secondary">Recent</Typography>
            <Box sx={{ flexGrow: 1 }} />
            <Button size="small" sx={{ fontSize: 12 }} onClick={clearRecents}>Clear</Button>
          </Box>
          <List dense disablePadding sx={{ mt: 0.5 }}>
            {recents.map((item) => (
              <RecentRow
                key={`${item.category}:${item.id}`}
                item={item}
                onClick={() => handleRecentClick(item)}
                onRemove={() => removeRecent(item.category, item.id)}
              />
            ))}
          </List>
        </Box>
      )}

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1 }}>
        Searching for
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, ml:1, mt: 1.5, mb: 1.5 }}>
        {active.map((cat) => (
          <Chip
            key={cat.key}
            label={cat.label}
            variant="outlined"
            
            onDelete={() => removeCategory(cat.key)}
            deleteIcon={<CloseIcon />}
            size="small"
            sx={{
              fontSize: 12,
              boxShadow: 1, 
              '& .MuiChip-deleteIcon': { fontSize: 14, backgroundColor: 'transparent' },
            }}
          />
        ))}
        {available.length > 0 && (
          <Chip
            label="+ Add new"
            variant="outlined"
            onClick={(e) => setMenuAnchor(e.currentTarget)}
            aria-label="add search category"
            size="small"
            sx={{ fontSize: 12 }}
          />
        )}
      </Box>

      {hasQuery && (
        <Box sx={{ mt: 1.5, flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {active.map((cat, idx) => {
            const Icon = cat.icon
            const state = results[cat.key]
            const items = state?.items ?? []
            const loading = state?.loading ?? false
            const limit = expanded[cat.key] ? EXPANDED_COUNT : COLLAPSED_COUNT
            return (
              <Box key={cat.key} sx={{ mt: idx === 0 ? 0 : 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Icon fontSize="small" sx={{ color: 'text.secondary' }} />
                  <Typography variant="subtitle2">{cat.label}</Typography>
                  {loading ? (
                    <CircularProgress size={16} thickness={5} sx={{ ml: 0.5 }} />
                  ) : (
                    <CountCircle count={items.length} />
                  )}
                  <Box sx={{ flexGrow: 1 }} />
                  {!loading && items.length > limit && (
                    <Button
                      size="small"
                      sx={{ fontSize: 12 }}
                      onClick={() => expandCategory(cat.key)}
                    >
                      Show all
                    </Button>
                  )}
                </Box>
                {!loading && (
                  items.length === 0 ? (
                    <Typography variant="body2" color="text.secondary" sx={{ ml: RESULT_INDENT, mt: 0.5 }}>
                      No results
                    </Typography>
                  ) : (
                    <List dense disablePadding sx={{ ml: RESULT_INDENT, mt: 0.5 }}>
                      {items.slice(0, limit).map((item) => (
                        <ListItemButton
                          key={item.id}
                          onClick={() => handleItemClick(cat.key, item)}
                          sx={{ borderRadius: 1, py: 0.25 }}
                        >
                          <ListItemText
                            primary={
                              item.badge ? (
                                <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                                  <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {item.label}
                                  </Box>
                                  <Chip label={item.badge} size="small" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                                </Box>
                              ) : (
                                item.label
                              )
                            }
                            secondary={item.sublabel}
                            slotProps={{
                              primary: { variant: 'body2', noWrap: true, component: 'div' },
                              secondary: { variant: 'caption', noWrap: true },
                            }}
                          />
                        </ListItemButton>
                      ))}
                    </List>
                  )
                )}
                {idx < active.length - 1 && <Divider sx={{ mt: 1.5 }} />}
              </Box>
            )
          })}
        </Box>
      )}

      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        {available.map((cat) => {
          const Icon = cat.icon
          return (
            <MenuItem key={cat.key} onClick={() => addCategory(cat.key)}>
              <ListItemIcon><Icon fontSize="small" /></ListItemIcon>
              <ListItemText>{cat.label}</ListItemText>
            </MenuItem>
          )
        })}
      </Menu>
    </Paper>
  )
}
