import type { Song, Id } from '../types/entities.ts'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { searchSongs } from '../api/songs.ts'

const MIN_CHARS = 3
const DEBOUNCE_MS = 250

// Add-only song search (no create option): each pick is reported via onSelect
// and the input clears, ready for the next addition. Already-linked ids are
// filtered out of results so a duplicate link can't be picked.

interface SongPickerProps {
  onSelect: (song: Song) => void
  excludeIds?: Id[]
  label?: string
}

export default function SongPicker({ onSelect, excludeIds = [], label }: Readonly<SongPickerProps>) {
  const { t } = useTranslation(['songs', 'common'])
  const [input, setInput] = useState('')   // what the field displays
  const [query, setQuery] = useState('')   // what we actually search on
  const [options, setOptions] = useState<Song[]>([])
  const [loading, setLoading] = useState(false)
  const reqIdRef = useRef(0)

  // Keyed on contents, not identity — callers pass a fresh array each render.
  const excludeKey = excludeIds.join(',')

  const trimmed = query.trim()
  const tooShort = trimmed.length < MIN_CHARS

  // Applies fetched rows iff this is still the latest request (guards against a
  // slow earlier search overwriting a newer one). Kept at component scope so the
  // effect's promise chain stays shallow (avoids deeply nested callbacks).
  function applyResults(rows: Song[], myReqId: number, excluded: Set<Id>) {
    if (reqIdRef.current !== myReqId) return
    setOptions(rows.filter((r) => r.id !== undefined && !excluded.has(r.id!)))
  }

  useEffect(() => {
    const myReqId = ++reqIdRef.current
    const excluded = new Set<Id>(excludeIds)
    if (tooShort) {
      const handle = setTimeout(() => {
        if (reqIdRef.current !== myReqId) return
        setOptions([])
        setLoading(false)
      }, 0)
      return () => clearTimeout(handle)
    }
    const startHandle = setTimeout(() => {
      if (reqIdRef.current !== myReqId) return
      setLoading(true)
    }, 0)
    const handle = setTimeout(() => {
      searchSongs(trimmed)
        .then((rows: Song[]) => applyResults(rows, myReqId, excluded))
        .catch(() => {
          if (reqIdRef.current !== myReqId) return
          setOptions([])
        })
        .finally(() => {
          if (reqIdRef.current !== myReqId) return
          setLoading(false)
        })
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(startHandle)
      clearTimeout(handle)
    }
    // excludeKey stands in for excludeIds (stable across renders by contents).
  }, [trimmed, tooShort, excludeKey]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleSelect(_event: React.SyntheticEvent, picked: Song | null) {
    if (!picked) return
    onSelect(picked)
    setInput('')
    setQuery('')
    setOptions([])
  }

  let noOptionsText = t($ => $.common.picker.noMatches)
  if (tooShort) noOptionsText = t($ => $.common.picker.typeMinChars, { count: MIN_CHARS })
  else if (loading) noOptionsText = t($ => $.common.picker.searching)

  return (
    <Autocomplete
      value={null}
      onChange={handleSelect}
      inputValue={input}
      onInputChange={(_e, v, reason) => {
        if (reason === 'input') { setInput(v); setQuery(v) }
        else if (reason === 'reset') setInput(v) // display only — not a search
        else if (reason === 'clear') { setInput(''); setQuery('') }
      }}
      options={options}
      filterOptions={(x) => x}
      loading={loading}
      getOptionLabel={(o) => o?.title ?? ''}
      isOptionEqualToValue={(a, b) => a?.id != null && a.id === b?.id}
      noOptionsText={noOptionsText}
      renderOption={(props, option) => (
        <li {...props} key={String(option.id)}>
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            <Typography variant="body2">{option.title}</Typography>
            {option.artist && (
              <Typography variant="caption" color="text.secondary">{option.artist}</Typography>
            )}
          </Box>
        </li>
      )}
      renderInput={(params) => <TextField {...params} label={label ?? t($ => $.addSong)} size="small" />}
    />
  )
}
