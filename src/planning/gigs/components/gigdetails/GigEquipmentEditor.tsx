import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import AirportShuttleIcon from '@mui/icons-material/AirportShuttle'
import CloseIcon from '@mui/icons-material/Close'
import LocationPinIcon from '@mui/icons-material/LocationPin'
import { setGigEquipment } from '../../gigs.ts'
import { useCompactLayout } from '../../../../hooks/useCompactLayout.ts'
import {
  DEFAULT_GIG_EQUIPMENT_PROVIDER,
  GIG_EQUIPMENT_ITEM_KEYS,
  type GigEquipmentItemKey,
  type GigEquipmentProvider,
} from '../../gigEquipment.ts'
import type { GigEquipmentEntry, Id } from '../../../../types/entities.ts'

interface ValueProps {
  label: string
  provider: GigEquipmentProvider
  providerLabel: string
  removeLabel: string
  atVenueLabel: string
  weBringLabel: string
  disabled: boolean
  canRemove: boolean
  isCompact: boolean
  onProviderChange: (next: GigEquipmentProvider | null) => void
  onDelete: () => void
}

function EquipmentValue({
  label,
  provider,
  providerLabel,
  removeLabel,
  atVenueLabel,
  weBringLabel,
  disabled,
  canRemove,
  isCompact,
  onProviderChange,
  onDelete,
}: Readonly<ValueProps>) {
  return (
    <Card
      variant="outlined"
      sx={{
        display: 'flex',
        width: '100%',
        alignItems: 'center',
        p: 1,
        gap: 0.5,
        pl: 1.5,
      }}
    >
      <Typography variant="body2" sx={{ flex: 1, minWidth: isCompact ? 0 : 90, pr: 1.5 }}>
        {label}
      </Typography>
      <Divider orientation="vertical" flexItem sx={{ my: 0.75 }} />
      <ToggleButtonGroup
        exclusive
        size={isCompact ? 'medium' : 'small'}
        value={provider}
        disabled={disabled}
        aria-label={providerLabel}
        onChange={(_event, next: GigEquipmentProvider | null) => onProviderChange(next)}
        sx={{
          borderRadius: 0,
          '& .MuiToggleButtonGroup-grouped': { border: 0, borderRadius: 0 },
          '& .MuiToggleButton-root': {
            // Roomier hit area on touch, where these are the primary control.
            py: isCompact ? 1.2 : 0.25,
            px: isCompact ? 1.2 : 1,
            border: 0,
            borderRadius: 0,
            opacity: 0.38,
            '&:hover': { opacity: 0.7 },
            '&.Mui-selected': { opacity: 1 },
          },
        }}
      >
        <ToggleButton value="event" aria-label={atVenueLabel} title={atVenueLabel}>
          <LocationPinIcon fontSize='small' />
        </ToggleButton>
        <ToggleButton value="band" aria-label={weBringLabel} title={weBringLabel}>
          <AirportShuttleIcon  fontSize='small' />
        </ToggleButton>
      </ToggleButtonGroup>
      {canRemove && (
        <IconButton size="small" disabled={disabled} aria-label={removeLabel} onClick={onDelete}>
          <CloseIcon fontSize="small" />
        </IconButton>
      )}
    </Card>
  )
}

interface Props {
  gigId: Id
  equipment: GigEquipmentEntry[]
  canWrite: boolean
  onChange: (equipment: GigEquipmentEntry[]) => void
}

export default function GigEquipmentEditor({ gigId, equipment, canWrite, onChange }: Readonly<Props>) {
  const { t } = useTranslation('gigs')
  const isCompact = useCompactLayout()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = equipment.map((entry) => entry.item)
  const providerByItem = new Map(equipment.map((entry) => [entry.item, entry.provider]))
  const itemLabel = (item: GigEquipmentItemKey) => t($ => $.detail.equipment.items[item])

  async function persist(next: GigEquipmentEntry[]) {
    setSaving(true)
    setError(null)
    try {
      onChange(await setGigEquipment(gigId, next))
    } catch (err) {
      // Fall back to the last server-confirmed set so an unsaved edit can't ride
      // along on the next PUT.
      onChange(equipment)
      setError(err instanceof Error ? err.message : t($ => $.detail.equipment.saveFailed))
    } finally {
      setSaving(false)
    }
  }

  function handleItemsChange(_event: unknown, items: GigEquipmentItemKey[]) {
    void persist(items.map((item) => ({
      item,
      provider: providerByItem.get(item) ?? DEFAULT_GIG_EQUIPMENT_PROVIDER,
    })))
  }

  // An exclusive ToggleButtonGroup emits null when the active button is clicked
  // again. An item always has a provider, so deselection is meaningless here.
  function handleProviderChange(item: GigEquipmentItemKey, next: GigEquipmentProvider | null) {
    if (!next) return
    void persist(equipment.map((entry) => (entry.item === item ? { ...entry, provider: next } : entry)))
  }

  function handleRemove(item: GigEquipmentItemKey) {
    void persist(equipment.filter((entry) => entry.item !== item))
  }

  return (
    <Stack spacing={1} sx={{ width: isCompact ? '100%' : '50%', pr: isCompact ? 0 : 1 }}>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <Stack spacing={0.5} sx={{ alignItems: 'stretch' }}>
        {equipment.map(({ item, provider }) => (
          <EquipmentValue
            key={item}
            label={itemLabel(item)}
            provider={provider}
            providerLabel={t($ => $.detail.equipment.providerLabel, { item: itemLabel(item) })}
            removeLabel={`${t($ => $.detail.equipment.remove)} ${itemLabel(item)}`}
            atVenueLabel={t($ => $.detail.equipment.provider.event)}
            weBringLabel={t($ => $.detail.equipment.provider.band)}
            disabled={!canWrite || saving}
            canRemove={canWrite}
            isCompact={isCompact}
            onProviderChange={(next) => handleProviderChange(item, next)}
            onDelete={() => handleRemove(item)}
          />
        ))}
      </Stack>

      {equipment.length === 0 && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t($ => $.detail.equipment.empty)}
        </Typography>
      )}

      <Autocomplete<GigEquipmentItemKey, true, true>
        multiple
        disableCloseOnSelect
        disableClearable
        readOnly={!canWrite}
        disabled={saving}
        options={GIG_EQUIPMENT_ITEM_KEYS}
        value={selected}
        onChange={handleItemsChange}
        getOptionLabel={itemLabel}
        // The collection above is the single source of truth for what's selected.
        renderValue={() => null}
        renderInput={(params) => (
          <TextField {...params} size="small" label={t($ => $.detail.equipment.add)} />
        )}
      />

      {/* The row is always in the flow with its height reserved — mounting it
          per save would push everything below the editor down and back. */}
      <Box
        data-testid="equipment-busy-slot"
        sx={{ display: 'flex', justifyContent: 'center', height: 16 }}
      >
        {saving && <CircularProgress size={16} />}
      </Box>
    </Stack>
  )
}
