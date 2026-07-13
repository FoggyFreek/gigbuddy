import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import ClickAwayListener from '@mui/material/ClickAwayListener'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import { alpha } from '@mui/material/styles'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined'
import { searchGigTags, setGigTags } from '../api/gigs.ts'
import type { GigTag, Id } from '../types/entities.ts'

interface Props {
  gigId: Id
  tags: GigTag[]
  canWrite: boolean
  onChange: (tags: GigTag[]) => void
}

export default function GigTagEditor({ gigId, tags, canWrite, onChange }: Readonly<Props>) {
  const { t } = useTranslation('gigs')
  const [editing, setEditing] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [options, setOptions] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const names = useMemo(() => tags.map((tag) => tag.name?.trim()).filter(Boolean) as string[], [tags])

  useEffect(() => {
    if (!editing) return
    let cancelled = false
    searchGigTags(inputValue)
      .then((rows) => {
        if (!cancelled) {
          const current = new Set(names.map((name) => name.toLowerCase()))
          setOptions(rows
            .map((tag) => tag.name?.trim())
            .filter((name): name is string => !!name && !current.has(name.toLowerCase())))
        }
      })
      .catch(() => { if (!cancelled) setOptions([]) })
    return () => { cancelled = true }
  }, [editing, inputValue, names])

  async function persist(nextNames: string[]) {
    setSaving(true)
    setError(null)
    try {
      const resolved = await setGigTags(gigId, nextNames)
      onChange(resolved)
      setEditing(false)
      setInputValue('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t($ => $.detail.tags.saveFailed))
    } finally {
      setSaving(false)
    }
  }

  function addTag(value: string | null) {
    const name = value?.trim()
    if (!name) return
    if (names.some((existing) => existing.toLowerCase() === name.toLowerCase())) {
      setEditing(false)
      setInputValue('')
      return
    }
    void persist([...names, name])
  }

  function closeEditor() {
    if (saving) return
    setEditing(false)
    setInputValue('')
    setError(null)
  }

  return (
    <Box
      sx={{
        position: 'absolute',
        top: 8,
        left: 8,
        zIndex: 3,
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 0.75,
        maxWidth: 'calc(100% - 100px)',
      }}
    >
      {tags.map((tag) => (
        <Chip
          key={String(tag.id ?? tag.name)}
          label={tag.name}
          size="small"
          onDelete={canWrite && !saving ? () => void persist(names.filter((name) => name !== tag.name)) : undefined}
          deleteIcon={canWrite ? <CloseIcon /> : undefined}
          sx={(theme) => ({
            color: '#fff',
            bgcolor: 'rgba(0,0,0,0.62)',
            '& .MuiChip-deleteIcon': {
              width: 16,
              height: 16,
              p: '2px',
              boxSizing: 'border-box',
              borderRadius: '50%',
              color: theme.palette.text.primary,
              bgcolor: alpha(theme.palette.background.paper, 0.48),
            },
            '& .MuiChip-deleteIcon:hover': {
              color: theme.palette.text.primary,
              bgcolor: theme.palette.background.paper,
            },
          })}
        />
      ))}

      {canWrite && !editing && names.length === 0 && (
        <Button
          size="small"
          variant="contained"
          startIcon={<LocalOfferOutlinedIcon />}
          onClick={() => setEditing(true)}
          sx={(theme) => ({
            bgcolor: alpha(theme.palette.background.paper, 0.88),
            color: theme.palette.text.primary,
            '&:hover': { bgcolor: alpha(theme.palette.background.paper, 1) },
          })}
        >
          {t($ => $.detail.tags.add)}
        </Button>
      )}

      {canWrite && !editing && names.length > 0 && (
        <Tooltip title={t($ => $.detail.tags.addAnother)}>
          <IconButton
            size="small"
            aria-label={t($ => $.detail.tags.addAnother)}
            onClick={() => setEditing(true)}
            sx={(theme) => ({
              bgcolor: alpha(theme.palette.background.paper, 0.48),
              color: theme.palette.text.primary,
              borderRadius: 0,
              width: 16,
              height: 16,
              p: 0,
              '&:hover': { bgcolor: alpha(theme.palette.background.paper, 1) },
            })}
          >
            <AddIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      )}

      {canWrite && editing && (
        <ClickAwayListener onClickAway={closeEditor}>
          <Box>
            <Autocomplete<string, false, false, true>
              freeSolo
              autoHighlight
              openOnFocus
              disablePortal
              options={options}
              inputValue={inputValue}
              onInputChange={(_event, value) => setInputValue(value)}
              onChange={(_event, value) => addTag(value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') closeEditor()
              }}
              filterOptions={(values) => values}
              disabled={saving}
              sx={{ width: 190, bgcolor: 'background.paper', borderRadius: 1 }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  autoFocus
                  size="small"
                  label={t($ => $.detail.tags.label)}
                  error={!!error}
                  helperText={error}
                  slotProps={{
                    ...params.slotProps,
                    input: {
                      ...params.slotProps?.input,
                      endAdornment: (
                        <>
                          {saving && <CircularProgress size={16} />}
                          {(params.slotProps?.input as Record<string, unknown>)?.endAdornment as ReactNode}
                        </>
                      ),
                    },
                  }}
                />
              )}
            />
          </Box>
        </ClickAwayListener>
      )}
    </Box>
  )
}
