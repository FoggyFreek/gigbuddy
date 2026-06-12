import { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { searchSongs } from '../api/songs.js'
import { idProp } from '../propTypes/shared.js'

const MIN_CHARS = 3
const DEBOUNCE_MS = 250

// Add-only song search (no create option): each pick is reported via onSelect
// and the input clears, ready for the next addition. Already-linked ids are
// filtered out of results so a duplicate link can't be picked.
export default function SongPicker({ onSelect, excludeIds = [], label = 'Add song' }) {
  const [input, setInput] = useState('')   // what the field displays
  const [query, setQuery] = useState('')   // what we actually search on
  const [options, setOptions] = useState([])
  const [loading, setLoading] = useState(false)
  const reqIdRef = useRef(0)

  // Keyed on contents, not identity — callers pass a fresh array each render.
  const excludeKey = excludeIds.join(',')

  const trimmed = query.trim()
  const tooShort = trimmed.length < MIN_CHARS

  useEffect(() => {
    const myReqId = ++reqIdRef.current
    const excluded = new Set(excludeIds)
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
        .then((rows) => {
          if (reqIdRef.current !== myReqId) return
          setOptions(rows.filter((r) => !excluded.has(r.id)))
        })
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

  function handleSelect(_event, picked) {
    if (!picked) return
    onSelect(picked)
    setInput('')
    setQuery('')
    setOptions([])
  }

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
      noOptionsText={
        tooShort
          ? `Type at least ${MIN_CHARS} characters…`
          : loading
            ? 'Searching…'
            : 'No matches'
      }
      renderOption={(props, option) => (
        <li {...props} key={option.id}>
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            <Typography variant="body2">{option.title}</Typography>
            {option.artist && (
              <Typography variant="caption" color="text.secondary">{option.artist}</Typography>
            )}
          </Box>
        </li>
      )}
      renderInput={(params) => <TextField {...params} label={label} size="small" />}
    />
  )
}

SongPicker.propTypes = {
  onSelect: PropTypes.func.isRequired,
  excludeIds: PropTypes.arrayOf(idProp),
  label: PropTypes.string,
}
