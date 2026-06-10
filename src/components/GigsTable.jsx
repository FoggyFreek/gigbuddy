import { useState } from 'react'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import InputAdornment from '@mui/material/InputAdornment'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Paper from '@mui/material/Paper'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import Collapse from '@mui/material/Collapse'
import ChecklistIcon from '@mui/icons-material/Checklist'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import FilterListIcon from '@mui/icons-material/FilterList'
import SearchIcon from '@mui/icons-material/Search'
import { useCompactLayout } from '../hooks/useCompactLayout.js'
import { venueHeadline, venueCity } from '../utils/venueDisplay.js'
import MemberAvatarStack from './MemberAvatarStack.jsx'
import StatusDot from './StatusDot.jsx'
import PropTypes from 'prop-types'
import { gigShape, idProp } from '../propTypes/shared.js'

const STATUS_COLORS = {
  option: 'default',
  confirmed: 'primary',
  announced: 'success',
}

const ALL_STATUSES = ['option', 'confirmed', 'announced']
const STATUS_LABELS = { option: 'Option', confirmed: 'Confirmed', announced: 'Announced' }

const COLUMN_COUNT = 7

function formatDate(val) {
  if (!val) return '—'
  return new Date(val).toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatTime(val) {
  if (!val) return '—'
  return val.slice(0, 5)
}

function isPastDate(val) {
  if (!val) return false
  const d = new Date(val)
  d.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return d < today
}

function applySearch(list, q) {
  if (!q) return list
  const lower = q.toLowerCase()
  return list.filter((g) =>
    [
      g.event_description,
      g.venue?.name, g.venue?.city, g.venue?.country,
      g.festival?.name, g.festival?.city, g.festival?.country,
    ].some((f) => f && String(f).toLowerCase().includes(lower))
  )
}

function GigCard({ gig, active, onClick }) {
  const taskCount = gig.open_task_count ?? 0
  const displayVenue = gig.venue ?? gig.festival
  const eventText = [gig.event_description, venueHeadline(displayVenue), venueCity(displayVenue)].filter(Boolean)
  return (
    <Box
      onClick={onClick}
      sx={{
        position: 'relative',
        overflow: 'hidden',
        p: 1.25,
        // Leave room on the left so the banner shows and fades out before the text begins.
        pl: 1.25,
        borderBottom: '1px solid',
        borderColor: 'divider',
        cursor: 'pointer',
        boxShadow: active ? (t) => `inset -3px 0 0 0 ${t.palette.primary.main}` : 'none',
        '&:last-of-type': { borderBottom: 'none' },
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Box sx={{ position: 'relative', zIndex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="body1">
            {formatDate(gig.event_date)}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            ({formatTime(gig.start_time)} – {formatTime(gig.end_time)})
          </Typography>
          {taskCount > 0 && (
            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.25, color: 'text.secondary' }}>
              <ChecklistIcon fontSize="small" />
              <Typography variant="caption">{taskCount}</Typography>
            </Box>
          )}
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
          {eventText.length ? eventText.join(' · ') : '—'}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', mt: 0.5 }}>
          <MemberAvatarStack members={gig.members_availability} />
          <Chip
            label={gig.status}
            color={STATUS_COLORS[gig.status] || 'default'}
            size="small"
            sx={{ ml: 'auto' }}
          />
        </Box>
      </Box>
    </Box>
  )
}

function DesktopRow({ gig, active, onClick }) {
  return (
    <TableRow
      hover
      onClick={onClick}
      sx={{
        cursor: 'pointer',
        boxShadow: active ? (t) => `inset -3px 0 0 0 ${t.palette.primary.main}` : 'none',
      }}
    >
      <TableCell padding="none" align="center" sx={{ pl: 1, width: 24 }}>
        <StatusDot color={STATUS_COLORS[gig.status] || 'default'} label={STATUS_LABELS[gig.status] || gig.status}/>
      </TableCell>
      <TableCell>{formatDate(gig.event_date)}</TableCell>
      <TableCell>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {gig.banner_path && (
            <Box
              component="img"
              src={`/api/files/${gig.banner_path}`}
              alt=""
              sx={{ height: 28, width: 28, objectFit: 'cover', borderRadius: 0.5, flexShrink: 0 }}
            />
          )}
          {gig.event_description}
        </Box>
      </TableCell>
      <TableCell>
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          <span>{venueHeadline(gig.venue ?? gig.festival) || ' '}</span>
          <Typography variant="caption" color="text.secondary">{venueCity(gig.venue ?? gig.festival) || ' '}</Typography>
        </Box>
      </TableCell>
      <TableCell>{formatTime(gig.start_time)}–{formatTime(gig.end_time)}</TableCell>
      <TableCell>
        <MemberAvatarStack members={gig.members_availability} />
      </TableCell>
      <TableCell align="center">
        {(gig.open_task_count ?? 0) > 0 && (
          <Box
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: '50%',
              bgcolor: 'action.hover',
            }}
          >
            {gig.open_task_count}
          </Box>
        )}
      </TableCell>
    </TableRow>
  )
}

function DesktopHead() {
  return (
    <TableHead>
      <TableRow sx={{ '& th': { fontWeight: 600 } }}>
        <TableCell padding="none" sx={{ width: 24 }} />
        <TableCell>Date</TableCell>
        <TableCell>Event</TableCell>
        <TableCell>Venue / City</TableCell>
        <TableCell>Time</TableCell>
        <TableCell>Band</TableCell>
        <TableCell align="center">Open tasks</TableCell>
      </TableRow>
    </TableHead>
  )
}

function PastGigsHeader({ open, count, onToggle }) {
  return (
    <Box
      onClick={onToggle}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        p: 1.25,
        cursor: 'pointer',
        userSelect: 'none',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <ExpandMoreIcon
        fontSize="small"
        sx={{
          transition: 'transform 150ms',
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        }}
      />
      <Typography variant="body2" fontWeight={600}>
        Past gigs ({count})
      </Typography>
    </Box>
  )
}

export default function GigsTable({ gigs, onRowClick, selectedId = null }) {
  const [pastOpen, setPastOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedStatuses, setSelectedStatuses] = useState(new Set(ALL_STATUSES))
  const [filterAnchor, setFilterAnchor] = useState(null)
  const isCompact = useCompactLayout()

  function toggleStatus(s) {
    setSelectedStatuses((prev) => {
      const next = new Set(prev)
      next.has(s) ? next.delete(s) : next.add(s)
      return next
    })
  }

  function toggleAllStatuses() {
    setSelectedStatuses((prev) =>
      prev.size === ALL_STATUSES.length ? new Set() : new Set(ALL_STATUSES)
    )
  }

  const allStatusesSelected = selectedStatuses.size === ALL_STATUSES.length
  const someStatusesSelected = selectedStatuses.size > 0 && !allStatusesSelected

  let filtered = applySearch(gigs, search)
  if (!allStatusesSelected) filtered = filtered.filter((g) => selectedStatuses.has(g.status))

  const upcoming = filtered.filter((g) => !isPastDate(g.event_date))
  const past = filtered.filter((g) => isPastDate(g.event_date))
  const emptyAll = gigs.length === 0

  const controls = (
    <Box sx={{ display: 'flex', gap: 1.5, mb: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
      <TextField
        size="small"
        placeholder="Search gigs…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        sx={{ flex: '1 1 200px', minWidth: 160 }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          },
        }}
      />
      <Button
        size="small"
        variant={someStatusesSelected ? 'contained' : 'outlined'}
        startIcon={<FilterListIcon />}
        onClick={(e) => setFilterAnchor(e.currentTarget)}
      >
        {someStatusesSelected ? `Filter (${selectedStatuses.size})` : 'Filter'}
      </Button>
      <Menu
        anchorEl={filterAnchor}
        open={Boolean(filterAnchor)}
        onClose={() => setFilterAnchor(null)}
      >
        <MenuItem dense onClick={toggleAllStatuses}>
          <Checkbox
            size="small"
            checked={allStatusesSelected}
            indeterminate={someStatusesSelected}
          />
          <ListItemText primary="All statuses" />
        </MenuItem>
        <Divider />
        {ALL_STATUSES.map((s) => (
          <MenuItem key={s} dense onClick={() => toggleStatus(s)}>
            <Checkbox size="small" checked={selectedStatuses.has(s)} />
            <ListItemText primary={STATUS_LABELS[s]} />
          </MenuItem>
        ))}
      </Menu>
    </Box>
  )

  if (isCompact) {
    return (
      <Stack spacing={1.5}>
        {controls}
        <Paper variant="outlined">
          {emptyAll ? (
            <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
              No gigs yet — add one to get started.
            </Box>
          ) : upcoming.length === 0 ? (
            <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
              No upcoming gigs.
            </Box>
          ) : (
            upcoming.map((gig) => (
              <GigCard key={gig.id} gig={gig} active={gig.id === selectedId} onClick={() => onRowClick(gig)} />
            ))
          )}
        </Paper>
        {past.length > 0 && (
          <Paper variant="outlined">
            <PastGigsHeader
              open={pastOpen}
              count={past.length}
              onToggle={() => setPastOpen((v) => !v)}
            />
            <Collapse in={pastOpen} unmountOnExit>
              <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
                {past.map((gig) => (
                  <GigCard key={gig.id} gig={gig} active={gig.id === selectedId} onClick={() => onRowClick(gig)} />
                ))}
              </Box>
            </Collapse>
          </Paper>
        )}
      </Stack>
    )
  }

  return (
    <Stack spacing={2}>
      {controls}
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <DesktopHead />
          <TableBody>
            {emptyAll && (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                  No gigs yet — add one to get started.
                </TableCell>
              </TableRow>
            )}
            {!emptyAll && upcoming.length === 0 && (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                  No upcoming gigs.
                </TableCell>
              </TableRow>
            )}
            {upcoming.map((gig) => (
              <DesktopRow key={gig.id} gig={gig} active={gig.id === selectedId} onClick={() => onRowClick(gig)} />
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {past.length > 0 && (
        <Paper variant="outlined">
          <PastGigsHeader
            open={pastOpen}
            count={past.length}
            onToggle={() => setPastOpen((v) => !v)}
          />
          <Collapse in={pastOpen} unmountOnExit>
            <TableContainer sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
              <Table size="small">
                <DesktopHead />
                <TableBody>
                  {past.map((gig) => (
                    <DesktopRow key={gig.id} gig={gig} active={gig.id === selectedId} onClick={() => onRowClick(gig)} />
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Collapse>
        </Paper>
      )}
    </Stack>
  )
}

const gigRowPropTypes = {
  gig: gigShape,
  active: PropTypes.bool,
  onClick: PropTypes.func,
}

GigCard.propTypes = gigRowPropTypes
DesktopRow.propTypes = gigRowPropTypes

PastGigsHeader.propTypes = {
  open: PropTypes.bool,
  count: PropTypes.number,
  onToggle: PropTypes.func,
}

GigsTable.propTypes = {
  gigs: PropTypes.arrayOf(gigShape),
  onRowClick: PropTypes.func,
  selectedId: idProp,
}
