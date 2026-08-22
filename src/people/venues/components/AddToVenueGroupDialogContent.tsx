import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import FormControlLabel from '@mui/material/FormControlLabel'
import InputAdornment from '@mui/material/InputAdornment'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import SearchIcon from '@mui/icons-material/Search'
import type { Id, VenueGroup } from '../../../types/entities.ts'
import {
  addVenueGroupMembers,
  createVenueGroup,
  listVenueGroups,
} from '../venueGroups.ts'

interface Result {
  group: VenueGroup
  addedCount: number
  alreadyPresentCount: number
}

interface Props {
  venueIds: Id[]
  onCancel: () => void
  onComplete: (result: Result) => void
}

export default function AddToVenueGroupDialogContent({ venueIds, onCancel, onComplete }: Readonly<Props>) {
  const { t } = useTranslation(['venues', 'common'])
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [query, setQuery] = useState('')
  const [groups, setGroups] = useState<VenueGroup[]>([])
  const [selectedId, setSelectedId] = useState<Id | null>(null)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (mode !== 'existing') return undefined
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      listVenueGroups(query, 10, { signal: controller.signal })
        .then((result) => {
          setGroups(result.items)
          setLoading(false)
        })
        .catch((reason: unknown) => {
          if (controller.signal.aborted) return
          setError(reason instanceof Error ? reason.message : String(reason))
          setLoading(false)
        })
    }, query ? 250 : 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [mode, query])

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      if (mode === 'new') {
        const result = await createVenueGroup(name, venueIds)
        onComplete({
          group: result.group,
          addedCount: result.added_count,
          alreadyPresentCount: result.already_present_count,
        })
        return
      }
      const group = groups.find((candidate) => String(candidate.id) === String(selectedId))
      if (!group || selectedId === null) return
      const result = await addVenueGroupMembers(group.id, venueIds)
      onComplete({
        group,
        addedCount: result.added_count,
        alreadyPresentCount: result.already_present_count,
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setSaving(false)
    }
  }

  const canSubmit = mode === 'new' ? name.trim().length > 0 : selectedId !== null

  return (
    <Box>
      <ToggleButtonGroup
        exclusive
        fullWidth
        size="small"
        value={mode}
        onChange={(_, value: 'existing' | 'new' | null) => {
          if (value) {
            setMode(value)
            setError(null)
          }
        }}
        sx={{ mb: 2 }}
      >
        <ToggleButton value="existing">{t($ => $.groups.existing)}</ToggleButton>
        <ToggleButton value="new">{t($ => $.groups.new)}</ToggleButton>
      </ToggleButtonGroup>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {mode === 'existing' ? (
        <>
          <TextField
            fullWidth
            size="small"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t($ => $.groups.searchPlaceholder)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
                ),
              },
            }}
          />
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={24} /></Box>
          ) : groups.length ? (
            <RadioGroup
              value={selectedId === null ? '' : String(selectedId)}
              onChange={(event) => setSelectedId(event.target.value)}
              sx={{ mt: 1 }}
            >
              {groups.map((group) => (
                <FormControlLabel
                  key={String(group.id)}
                  value={String(group.id)}
                  control={<Radio size="small" />}
                  label={group.name}
                />
              ))}
            </RadioGroup>
          ) : (
            <Typography variant="body2" sx={{ color: 'text.secondary', py: 2 }}>
              {t($ => $.groups.noGroups)}
            </Typography>
          )}
        </>
      ) : (
        <TextField
          autoFocus
          fullWidth
          size="small"
          label={t($ => $.groups.name)}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && canSubmit && !saving) void submit()
          }}
        />
      )}

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 3 }}>
        <Button onClick={onCancel} disabled={saving}>{t($ => $.common.actions.cancel)}</Button>
        <Button variant="contained" onClick={() => { void submit() }} disabled={!canSubmit || saving}>
          {saving ? <CircularProgress size={20} /> : t($ => $.groups.addSelected)}
        </Button>
      </Box>
    </Box>
  )
}
