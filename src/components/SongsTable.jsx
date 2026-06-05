import { useState } from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import InputAdornment from '@mui/material/InputAdornment'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TablePagination from '@mui/material/TablePagination'
import TableRow from '@mui/material/TableRow'
import TableSortLabel from '@mui/material/TableSortLabel'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import SearchIcon from '@mui/icons-material/Search'
import { useCompactLayout } from '../hooks/useCompactLayout.js'
import { formatDuration } from '../utils/formatDuration.js'
import { songShape } from '../propTypes/shared.js'

const PAGE_SIZE = 25

const COLUMNS = [
  { id: 'title',    label: 'Title' },
  { id: 'artist',   label: 'Artist' },
  { id: 'song_key', label: 'Key' },
  { id: 'tempo',    label: 'Tempo' },
  { id: 'duration', label: 'Duration' },
  { id: 'tags',     label: 'Tags' },
]
const COLUMN_COUNT = COLUMNS.length

function tagNames(song) {
  return (song.tags || []).map((t) => t.name)
}

function sortValue(song, col) {
  switch (col) {
    case 'title':    return (song.title || '').toLowerCase()
    case 'artist':   return (song.artist || '').toLowerCase()
    case 'song_key': return (song.song_key || '').toLowerCase()
    case 'tempo':    return song.tempo ?? -1
    case 'duration': return song.duration_seconds ?? -1
    case 'tags':     return tagNames(song).join(',').toLowerCase()
    default:         return ''
  }
}

function applySort(list, sortBy, sortDir) {
  return [...list].sort((a, b) => {
    const av = sortValue(a, sortBy)
    const bv = sortValue(b, sortBy)
    let cmp
    if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv
    else cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' })
    return sortDir === 'asc' ? cmp : -cmp
  })
}

function applySearch(list, q) {
  if (!q) return list
  const lower = q.toLowerCase()
  return list.filter((s) =>
    [s.title, s.artist, s.song_key, ...tagNames(s)]
      .some((f) => f && String(f).toLowerCase().includes(lower)),
  )
}

function TagChips({ song }) {
  const names = tagNames(song)
  if (names.length === 0) return null
  return (
    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
      {names.map((n) => (
        <Chip key={n} label={n} size="small" variant="outlined" />
      ))}
    </Stack>
  )
}
TagChips.propTypes = { song: songShape.isRequired }

function SongCard({ song, active, onClick }) {
  const meta = [
    song.artist,
    song.song_key,
    song.tempo ? `${song.tempo} BPM` : null,
    formatDuration(song.duration_seconds),
  ].filter(Boolean).join(' · ')
  return (
    <Box
      onClick={onClick}
      sx={{
        p: 1.25,
        cursor: 'pointer',
        borderBottom: '1px solid',
        borderColor: 'divider',
        boxShadow: active ? (t) => `inset -3px 0 0 0 ${t.palette.primary.main}` : 'none',
        '&:hover': { bgcolor: 'action.hover' },
        '&:last-of-type': { borderBottom: 'none' },
      }}
    >
      <Typography variant="body2" fontWeight={600} noWrap>
        {song.title}
      </Typography>
      {meta && (
        <Typography variant="caption" color="text.secondary">
          {meta}
        </Typography>
      )}
      <Box sx={{ mt: 0.5 }}>
        <TagChips song={song} />
      </Box>
    </Box>
  )
}
SongCard.propTypes = {
  song: songShape.isRequired,
  active: PropTypes.bool,
  onClick: PropTypes.func.isRequired,
}

export default function SongsTable({ songs, onRowClick, selectedId = null }) {
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('title')
  const [sortDir, setSortDir] = useState('asc')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(PAGE_SIZE)
  const isCompact = useCompactLayout()

  function handleSort(col) {
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(col)
      setSortDir('asc')
    }
    setPage(0)
  }

  function handleSearch(val) {
    setSearch(val)
    setPage(0)
  }

  const sorted = applySort(applySearch(songs, search), sortBy, sortDir)
  const paged = sorted.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
  const isEmpty = songs.length === 0

  const controls = (
    <TextField
      size="small"
      placeholder="Search songs…"
      value={search}
      onChange={(e) => handleSearch(e.target.value)}
      sx={{ mb: 1.5, width: '100%' }}
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
  )

  const pagination = sorted.length > rowsPerPage || !isCompact ? (
    <TablePagination
      component="div"
      count={sorted.length}
      page={page}
      rowsPerPage={rowsPerPage}
      rowsPerPageOptions={[25, 50, 100]}
      onPageChange={(_, p) => setPage(p)}
      onRowsPerPageChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(0) }}
    />
  ) : null

  if (isCompact) {
    return (
      <Stack spacing={1.5}>
        {controls}
        <Paper variant="outlined">
          {isEmpty ? (
            <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
              No songs yet — add one or import from CSV.
            </Box>
          ) : sorted.length === 0 ? (
            <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>No results.</Box>
          ) : (
            paged.map((s) => (
              <SongCard
                key={s.id}
                song={s}
                active={s.id === selectedId}
                onClick={() => onRowClick(s)}
              />
            ))
          )}
        </Paper>
        {sorted.length > rowsPerPage && pagination}
      </Stack>
    )
  }

  return (
    <Stack spacing={1.5}>
      {controls}
      <Paper variant="outlined">
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { fontWeight: 600 } }}>
                {COLUMNS.map((col) => (
                  <TableCell key={col.id}>
                    <TableSortLabel
                      active={sortBy === col.id}
                      direction={sortBy === col.id ? sortDir : 'asc'}
                      onClick={() => handleSort(col.id)}
                    >
                      {col.label}
                    </TableSortLabel>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {isEmpty && (
                <TableRow>
                  <TableCell colSpan={COLUMN_COUNT} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                    No songs yet — add one or import from CSV.
                  </TableCell>
                </TableRow>
              )}
              {!isEmpty && sorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={COLUMN_COUNT} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                    No results.
                  </TableCell>
                </TableRow>
              )}
              {paged.map((s) => (
                <TableRow
                  key={s.id}
                  hover
                  selected={s.id === selectedId}
                  onClick={() => onRowClick(s)}
                  sx={{
                    cursor: 'pointer',
                    boxShadow: s.id === selectedId ? (t) => `inset -3px 0 0 0 ${t.palette.primary.main}` : 'none',
                  }}
                >
                  <TableCell>{s.title}</TableCell>
                  <TableCell>{s.artist || '—'}</TableCell>
                  <TableCell>{s.song_key || '—'}</TableCell>
                  <TableCell>{s.tempo || '—'}</TableCell>
                  <TableCell>{formatDuration(s.duration_seconds) || '—'}</TableCell>
                  <TableCell><TagChips song={s} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {pagination}
      </Paper>
    </Stack>
  )
}

SongsTable.propTypes = {
  songs: PropTypes.arrayOf(songShape).isRequired,
  onRowClick: PropTypes.func.isRequired,
  selectedId: PropTypes.number,
}
