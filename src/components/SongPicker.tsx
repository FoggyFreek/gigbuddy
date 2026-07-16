import type { Song, Id } from '../types/entities.ts'
import { useTranslation } from 'react-i18next'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { searchSongs } from '../api/songs.ts'
import useRemoteSearch from '../hooks/useRemoteSearch.ts'

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
  const excludeKey = excludeIds.join(',')
  const {
    inputValue, options, loading, tooShort, minChars, onInputChange, clear,
  } = useRemoteSearch<Song>({
    search: searchSongs,
    dependencyKey: excludeKey,
    filterResults: (rows) => {
      const excluded = new Set<Id>(excludeIds)
      return rows.filter((row) => row.id !== undefined && !excluded.has(row.id))
    },
  })

  function handleSelect(_event: React.SyntheticEvent, picked: Song | null) {
    if (!picked) return
    onSelect(picked)
    clear()
  }

  let noOptionsText = t($ => $.common.picker.noMatches)
  if (tooShort) noOptionsText = t($ => $.common.picker.typeMinChars, { count: minChars })
  else if (loading) noOptionsText = t($ => $.common.picker.searching)

  return (
    <Autocomplete
      value={null}
      onChange={handleSelect}
      inputValue={inputValue}
      onInputChange={onInputChange}
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
