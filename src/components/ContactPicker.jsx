import { useEffect, useMemo, useRef, useState } from 'react'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { searchContacts } from '../api/contacts.js'
import ContactFormModal from './ContactFormModal.jsx'

const MIN_CHARS = 3
const DEBOUNCE_MS = 250

// An "add" control: searches contacts after MIN_CHARS, offers to create one
// when nothing matches, and reports the chosen contact via onSelect. Contacts
// in excludeIds (already linked) are filtered out so a duplicate link can't be
// picked — the _client.js error path can't surface the server's 409 cleanly.
export default function ContactPicker({ onSelect, excludeIds = [], disabled, label = 'Add contact' }) {
  const [input, setInput] = useState('')
  const [options, setOptions] = useState([])
  const [loading, setLoading] = useState(false)
  const [createPrefill, setCreatePrefill] = useState(null) // { name } | null
  const reqIdRef = useRef(0)

  const excluded = useMemo(() => new Set(excludeIds), [excludeIds])

  const trimmed = input.trim()
  const tooShort = trimmed.length < MIN_CHARS

  useEffect(() => {
    const myReqId = ++reqIdRef.current
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
  }, [trimmed, tooShort, excluded])

  const augmentedOptions = useMemo(() => {
    if (tooShort || loading) return options
    if (options.length > 0) return options
    return [{ __action: 'create-contact', __label: `+ Create contact '${trimmed}'` }]
  }, [options, tooShort, loading, trimmed])

  function handleSelect(_event, picked) {
    if (!picked) return
    if (picked.__action === 'create-contact') {
      setCreatePrefill({ name: trimmed })
      return
    }
    onSelect(picked)
    setInput('')
    setOptions([])
  }

  function handleCreated(contact) {
    setCreatePrefill(null)
    setInput('')
    setOptions([])
    onSelect(contact)
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
        getOptionLabel={(o) => (o?.__action ? o.__label : o.name || '')}
        isOptionEqualToValue={(a, b) => a?.id != null && a.id === b?.id}
        noOptionsText={
          tooShort
            ? `Type at least ${MIN_CHARS} characters…`
            : loading
              ? 'Searching…'
              : 'No matches'
        }
        renderOption={(props, option) => {
          if (option.__action) {
            return (
              <li {...props} key={option.__action}>
                <Typography variant="body2" color="primary">{option.__label}</Typography>
              </li>
            )
          }
          const subtitle = [option.category, option.email].filter(Boolean).join(' · ')
          return (
            <li {...props} key={option.id}>
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
