import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import useRemoteSearch from '../../../hooks/useRemoteSearch.ts'
import type { Album } from '../../../types/entities.ts'
import { listAlbums } from '../songs.ts'
import AlbumFormModal from './AlbumFormModal.tsx'

interface CreateAction {
  __action: 'create-album'
  __label: string
}

type AlbumOption = Album | CreateAction

function isCreateAction(option: unknown): option is CreateAction {
  return typeof option === 'object' && option !== null && '__action' in option
}

function releaseYear(album: Album): string {
  return album.release_date?.slice(0, 4) ?? ''
}

interface Props {
  value: Album | null
  onChange: (album: Album | null) => void
  readOnly?: boolean
}

export default function AlbumPicker({ value, onChange, readOnly = false }: Readonly<Props>) {
  const { t } = useTranslation('songs')
  const [open, setOpen] = useState(false)
  const [createTitle, setCreateTitle] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const { inputValue, query, options, loading, onInputChange, clear } = useRemoteSearch<Album>({
    search: listAlbums,
    minChars: 0,
  })

  const hasExactMatch = options.some(
    (album) => (album.title ?? '').localeCompare(query, undefined, { sensitivity: 'accent' }) === 0,
  )
  const augmentedOptions: AlbumOption[] = useMemo(() => {
    if (!query || loading || hasExactMatch || readOnly) return options
    return [
      ...options,
      { __action: 'create-album' as const, __label: t($ => $.albums.createOption, { title: query }) },
    ]
  }, [hasExactMatch, loading, options, query, readOnly, t])

  function handleChange(_event: React.SyntheticEvent, selected: AlbumOption | null) {
    setOpen(false)
    if (!selected) {
      onChange(null)
      return
    }
    if (isCreateAction(selected)) {
      setCreateTitle(query)
      return
    }
    // Let MUI remove the portalled options popper before a parent opens the
    // album-art confirmation dialog for this selection.
    setTimeout(() => onChange(selected), 0)
  }

  function handleCreated(album: Album) {
    setCreateTitle(null)
    clear()
    onChange(album)
  }

  return (
    <>
      <Autocomplete<AlbumOption, false, false, false>
        open={open}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        value={value}
        onChange={handleChange}
        inputValue={inputValue}
        onInputChange={onInputChange}
        options={augmentedOptions}
        filterOptions={(rows) => rows}
        loading={loading}
        readOnly={readOnly}
        openOnFocus
        getOptionLabel={(option) => isCreateAction(option) ? option.__label : option.title ?? ''}
        isOptionEqualToValue={(a, b) => {
          if (isCreateAction(a) || isCreateAction(b)) return false
          return a.id !== undefined && a.id === b.id
        }}
        noOptionsText={t($ => $.albums.noMatches)}
        loadingText={t($ => $.albums.searching)}
        renderOption={(props, option) => {
          if (isCreateAction(option)) {
            return (
              <li {...props} key={option.__action}>
                <AddIcon fontSize="small" sx={{ mr: 1, color: 'primary.main' }} />
                <Typography variant="body2" sx={{ color: 'primary.main' }}>{option.__label}</Typography>
              </li>
            )
          }
          const year = releaseYear(option)
          return (
            <li {...props} key={String(option.id)}>
              <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                <Typography variant="body2">{option.title}</Typography>
                {year && <Typography variant="caption" sx={{ color: 'text.secondary' }}>{year}</Typography>}
              </Box>
            </li>
          )
        }}
        renderInput={(params) => {
          const inputSlotProps = params.slotProps?.input as Record<string, unknown>
          return (
            <TextField
              {...params}
              label={t($ => $.fields.album)}
              slotProps={{
                ...params.slotProps,
                input: {
                  ...inputSlotProps,
                  endAdornment: (
                    <>
                      {value?.id !== undefined && !readOnly && (
                        <InputAdornment position="end" sx={{ m: 0 }}>
                          <Tooltip title={t($ => $.albums.editAction)}>
                            <IconButton
                              size="small"
                              aria-label={t($ => $.albums.editAction)}
                              onMouseDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                event.stopPropagation()
                                setEditing(true)
                              }}
                            >
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </InputAdornment>
                      )}
                      {inputSlotProps?.endAdornment as React.ReactNode}
                    </>
                  ),
                },
              }}
            />
          )
        }}
      />
      {createTitle !== null && (
        <AlbumFormModal
          initialTitle={createTitle}
          onSaved={handleCreated}
          onClose={() => setCreateTitle(null)}
        />
      )}
      {editing && value && (
        <AlbumFormModal
          album={value}
          onSaved={(saved) => { setEditing(false); onChange(saved) }}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  )
}
