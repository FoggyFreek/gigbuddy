import type { Song, Id } from '../types/entities.ts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import ListPagination from './shared/ListPagination.tsx'
import TableRow from '@mui/material/TableRow'
import TableSortLabel from '@mui/material/TableSortLabel'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import SearchIcon from '@mui/icons-material/Search'
import { useCompactLayout } from '../hooks/useCompactLayout.ts'
import { formatDuration } from '../utils/formatDuration.ts'
import SongCoverThumb from './SongCoverThumb.tsx'

const PAGE_SIZE = 25

const COLUMNS = [
  { id: 'title',    labelKey: 'title' },
  { id: 'song_key', labelKey: 'key' },
  { id: 'tempo',    labelKey: 'tempo' },
  { id: 'duration', labelKey: 'duration' },
  { id: 'tags',     labelKey: 'tags' },
] as const
// +1 for the unsortable cover-image column in front of the sortable ones.
const COLUMN_COUNT = COLUMNS.length + 1

function tagNames(song: Song): string[] {
  return (song.tags || []).map((t) => t.name ?? '')
}

function sortValue(song: Song, col: string): string | number {
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

function applySort(list: Song[], sortBy: string, sortDir: 'asc' | 'desc'): Song[] {
  return [...list].sort((a, b) => {
    const av = sortValue(a, sortBy)
    const bv = sortValue(b, sortBy)
    let cmp: number
    if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv
    else cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' })
    return sortDir === 'asc' ? cmp : -cmp
  })
}

function applySearch(list: Song[], q: string): Song[] {
  if (!q) return list
  const lower = q.toLowerCase()
  return list.filter((s) =>
    [s.title, s.artist, s.song_key, ...tagNames(s)]
      .some((f) => f && String(f).toLowerCase().includes(lower)),
  )
}

function TagChips({ song }: Readonly<{ song: Song }>) {
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

function SongCard({ song, active, onClick }: Readonly<{ song: Song; active: boolean; onClick: () => void }>) {
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
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
          <SongCoverThumb path={song.cover_image_path} size={40} alt={song.title || ''} />
          <Stack direction="column" spacing={0} sx={{ minWidth: 0 }}>
            <Typography sx={{ variant: 'body2', fontWeight: 'medium' }} noWrap>
              {song.title}
            </Typography>
            <Typography variant="subtitle2" noWrap sx={{ color: 'text.disabled' }}>
              {song.artist}
            </Typography>
          </Stack>
        </Stack>
        <Stack direction="column" spacing={0.5} sx={{ mt: 0.5 }}>
          <Typography variant="subtitle2" color="text.secondary" noWrap>
            {formatDuration(song.duration_seconds)}
          </Typography>
        </Stack>
      </Stack>
    </Box>
  )
}

interface SongsTableProps {
  songs: Song[]
  onRowClick: (song: Song) => void
  selectedId?: Id | null
}

export default function SongsTable({ songs, onRowClick, selectedId = null }: Readonly<SongsTableProps>) {
  const { t } = useTranslation('songs')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('title')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(PAGE_SIZE)
  const isCompact = useCompactLayout()

  function handleSort(col: string) {
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(col)
      setSortDir('asc')
    }
    setPage(0)
  }

  function handleSearch(val: string) {
    setSearch(val)
    setPage(0)
  }

  const sorted = applySort(applySearch(songs, search), sortBy, sortDir)
  const paged = sorted.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
  const isEmpty = songs.length === 0

  const controls = (
    <TextField
      size="small"
      placeholder={t($ => $.searchSongs)}
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
    <ListPagination
      count={sorted.length}
      page={page}
      rowsPerPage={rowsPerPage}
      rowsPerPageOptions={[25, 50, 100]}
      onPageChange={(_, p) => setPage(p)}
      onRowsPerPageChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(0) }}
    />
  ) : null

  if (isCompact) {
    let compactBody
    if (isEmpty) {
      compactBody = (
        <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
          {t($ => $.table.empty)}
        </Box>
      )
    } else if (sorted.length === 0) {
      compactBody = (
        <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>{t($ => $.table.noResults)}</Box>
      )
    } else {
      compactBody = paged.map((s) => (
        <SongCard
          key={String(s.id)}
          song={s}
          active={s.id === selectedId}
          onClick={() => onRowClick(s)}
        />
      ))
    }
    return (
      <Stack spacing={1.5}>
        {controls}
        <Paper variant="outlined">
          {compactBody}
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
                <TableCell sx={{ width: 56 }} />
                {COLUMNS.map((col) => (
                  <TableCell key={col.id}>
                    <TableSortLabel
                      active={sortBy === col.id}
                      direction={sortBy === col.id ? sortDir : 'asc'}
                      onClick={() => handleSort(col.id)}
                    >
                      {t($ => $.fields[col.labelKey])}
                    </TableSortLabel>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {isEmpty && (
                <TableRow>
                  <TableCell colSpan={COLUMN_COUNT} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                    {t($ => $.table.empty)}
                  </TableCell>
                </TableRow>
              )}
              {!isEmpty && sorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={COLUMN_COUNT} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                    {t($ => $.table.noResults)}
                  </TableCell>
                </TableRow>
              )}
              {paged.map((s) => (
                <TableRow
                  key={String(s.id)}
                  hover
                  selected={s.id === selectedId}
                  onClick={() => onRowClick(s)}
                  sx={{
                    cursor: 'pointer',
                    boxShadow: s.id === selectedId ? (t) => `inset -3px 0 0 0 ${t.palette.primary.main}` : 'none',
                  }}
                >
                  <TableCell sx={{ width: 56, pr: 0 }}>
                    <SongCoverThumb path={s.cover_image_path} size={40} alt={s.title || ''} />
                  </TableCell>
                  <TableCell>
                    <Typography sx={{ variant: 'body2', fontWeight: 'medium' }} noWrap>
                      {s.title}
                    </Typography>
                    {s.artist && (
                      <Typography variant="subtitle2" noWrap sx={{ color: 'text.disabled' }}>
                        {s.artist}
                      </Typography>
                    )}
                  </TableCell>
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
