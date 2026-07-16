import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { searchContacts } from '../api/contacts.ts'
import useRemoteSearch from '../hooks/useRemoteSearch.ts'
import type { Contact, Id } from '../types/entities.ts'
import ContactFormModal from './ContactFormModal.tsx'

interface ContactPickerProps {
  onSelect: (contact: Contact) => void
  excludeIds?: Id[]
  disabled?: boolean
  label?: string
}

type ActionOption = { __action: string; __label: string }
type PickerOption = Contact | ActionOption

function isActionOption(o: PickerOption): o is ActionOption {
  return '__action' in o
}

// An "add" control: searches contacts after the shared minimum query length,
// offers to create one when nothing matches, and reports the chosen contact via
// onSelect. Already-linked contacts are filtered out of the remote results.
export default function ContactPicker({ onSelect, excludeIds = [], disabled, label }: Readonly<ContactPickerProps>) {
  const { t } = useTranslation('common')
  const resolvedLabel = label ?? t($ => $.contactPicker.label)
  const [createPrefill, setCreatePrefill] = useState<{ name: string } | null>(null)
  const excludeKey = excludeIds.join(',')
  const {
    inputValue, query, options, loading, tooShort, minChars, onInputChange, clear,
  } = useRemoteSearch<Contact>({
    search: searchContacts,
    dependencyKey: excludeKey,
    filterResults: (rows) => {
      const excluded = new Set<Id>(excludeIds)
      return rows.filter((row) => row.id !== undefined && !excluded.has(row.id))
    },
  })

  const augmentedOptions = useMemo((): PickerOption[] => {
    if (tooShort || loading) return options
    if (options.length > 0) return options
    return [{ __action: 'create-contact', __label: t($ => $.contactPicker.createContact, { name: query }) }]
  }, [options, tooShort, loading, query, t])

  function handleSelect(_event: React.SyntheticEvent, picked: PickerOption | null) {
    if (!picked) return
    if (isActionOption(picked)) {
      if (picked.__action === 'create-contact') setCreatePrefill({ name: query })
      return
    }
    onSelect(picked)
    clear()
  }

  function handleCreated(contact: Contact) {
    setCreatePrefill(null)
    clear()
    onSelect(contact)
  }

  let noOptionsText: string
  if (tooShort) {
    noOptionsText = t($ => $.picker.typeMinChars, { count: minChars })
  } else if (loading) {
    noOptionsText = t($ => $.picker.searching)
  } else {
    noOptionsText = t($ => $.picker.noMatches)
  }

  return (
    <>
      <Autocomplete
        value={null}
        onChange={handleSelect}
        inputValue={inputValue}
        onInputChange={onInputChange}
        options={augmentedOptions}
        filterOptions={(x) => x}
        loading={loading}
        disabled={disabled}
        blurOnSelect
        getOptionLabel={(o) => (isActionOption(o) ? o.__label : o.name || '')}
        isOptionEqualToValue={(a, b) => {
          if (isActionOption(a) || isActionOption(b)) return false
          return a?.id != null && a.id === b?.id
        }}
        noOptionsText={noOptionsText}
        renderOption={(props, option) => {
          if (isActionOption(option)) {
            return (
              <li {...props} key={option.__action}>
                <Typography variant="body2" color="primary">{option.__label}</Typography>
              </li>
            )
          }
          const subtitle = [option.category, option.email].filter(Boolean).join(' · ')
          return (
            <li {...props} key={String(option.id)}>
              <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                <Typography variant="body2">{option.name}</Typography>
                {subtitle && (
                  <Typography variant="caption" color="text.secondary">{subtitle}</Typography>
                )}
              </Box>
            </li>
          )
        }}
        renderInput={(params) => <TextField {...params} label={resolvedLabel} />}
      />
      {createPrefill && (
        <ContactFormModal
          mode="create"
          initial={createPrefill}
          onCreated={handleCreated}
          onClose={() => setCreatePrefill(null)}
        />
      )}
    </>
  )
}
