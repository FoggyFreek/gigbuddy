import { useEffect, useMemo, useRef, useState } from 'react'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { searchContacts } from '../api/contacts.ts'
import type { Contact, Id } from '../types/entities.ts'
import ContactFormModal from './ContactFormModal.tsx'

interface ContactPickerProps {
  onSelect: (contact: Contact) => void
  excludeIds?: Id[]
  disabled?: boolean
  label?: string
}

const MIN_CHARS = 3
const DEBOUNCE_MS = 250

type ActionOption = { __action: string; __label: string }
type PickerOption = Contact | ActionOption

function isActionOption(o: PickerOption): o is ActionOption {
  return '__action' in o
}

// An "add" control: searches contacts after MIN_CHARS, offers to create one
// when nothing matches, and reports the chosen contact via onSelect. Contacts
// in excludeIds (already linked) are filtered out so a duplicate link can't be
// picked — the _client.js error path can't surface the server's 409 cleanly.
export default function ContactPicker({ onSelect, excludeIds = [], disabled, label = 'Add contact' }: ContactPickerProps) {
  const [input, setInput] = useState('')
  const [options, setOptions] = useState<Contact[]>([])
  const [loading, setLoading] = useState(false)
  const [createPrefill, setCreatePrefill] = useState<{ name: string } | null>(null)
  const reqIdRef = useRef<number>(0)

  const excluded = useMemo(() => new Set(excludeIds), [excludeIds])

  const trimmed = input.trim()
  const tooShort = trimmed.length < MIN_CHARS

  useEffect(() => {
    const myReqId = ++reqIdRef.current
    const notExcluded = (r: Contact) => !excluded.has(r.id!)
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
      searchContacts(trimmed)
        .then((rows: Contact[]) => {
          if (reqIdRef.current !== myReqId) return
          setOptions(rows.filter(notExcluded))
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
  }, [trimmed, tooShort, excluded])

  const augmentedOptions = useMemo((): PickerOption[] => {
    if (tooShort || loading) return options
    if (options.length > 0) return options
    return [{ __action: 'create-contact', __label: `+ Create contact '${trimmed}'` }]
  }, [options, tooShort, loading, trimmed])

  function handleSelect(_event: React.SyntheticEvent, picked: PickerOption | null) {
    if (!picked) return
    if (isActionOption(picked)) {
      if (picked.__action === 'create-contact') {
        setCreatePrefill({ name: trimmed })
      }
      return
    }
    onSelect(picked)
    setInput('')
    setOptions([])
  }

  function handleCreated(contact: Contact) {
    setCreatePrefill(null)
    setInput('')
    setOptions([])
    onSelect(contact)
  }

  let noOptionsText: string
  if (tooShort) {
    noOptionsText = `Type at least ${MIN_CHARS} characters…`
  } else if (loading) {
    noOptionsText = 'Searching…'
  } else {
    noOptionsText = 'No matches'
  }

  return (
    <>
      <Autocomplete
        value={null}
        onChange={handleSelect}
        inputValue={input}
        onInputChange={(_e, v, reason) => {
          if (reason === 'input') setInput(v)
          else if (reason === 'clear') setInput('')
        }}
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
        renderInput={(params) => <TextField {...params} label={label} />}
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
