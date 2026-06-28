import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Contact, Id } from '../../types/entities.ts'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import InputAdornment from '@mui/material/InputAdornment'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import SearchIcon from '@mui/icons-material/Search'
import { createContact, searchContacts } from '../../api/contacts.ts'

const MIN_CHARS = 3
const DEBOUNCE_MS = 250

// An action option injected at the end of the list when no exact match exists.
interface ActionOption {
  __action: 'create-supplier'
  __label: string
}

type SupplierOption = Contact | ActionOption

// `o` can be a raw string at runtime: freeSolo Autocomplete passes the typed
// text through as an option, so guard for a non-null object before `in`
// ('__action' in 'someString' throws).
function isAction(o: unknown): o is ActionOption {
  return typeof o === 'object' && o !== null && '__action' in o
}

interface SupplierAutocompleteProps {
  value?: string
  onChange: (patch: { supplier_name: string; supplier_contact_id: Id | null }) => void
  disabled?: boolean
  autoFocus?: boolean
  label?: string
}

// Supplier field: searches contacts, lets the user free-type a name, and offers
// to silently create a 'supplier' contact when nothing matches. Because
// _client.request drops the status/code on a non-401 error, a failed create
// falls back to re-searching and selecting an exact match rather than reading
// the error shape.
export default function SupplierAutocomplete({
  value, onChange, disabled, autoFocus, label,
}: SupplierAutocompleteProps) {
  const { t } = useTranslation(['purchases', 'common'])
  const [options, setOptions] = useState<Contact[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reqIdRef = useRef(0)

  const trimmed = (value || '').trim()
  const tooShort = trimmed.length < MIN_CHARS

  useEffect(() => {
    const myReqId = ++reqIdRef.current
    if (tooShort) {
      const reset = setTimeout(() => {
        if (reqIdRef.current !== myReqId) return
        setOptions([])
        setLoading(false)
      }, 0)
      return () => clearTimeout(reset)
    }
    const startHandle = setTimeout(() => {
      if (reqIdRef.current === myReqId) setLoading(true)
    }, 0)
    const handle = setTimeout(() => {
      searchContacts(trimmed)
        .then((rows) => { if (reqIdRef.current === myReqId) setOptions(rows) })
        .catch(() => { if (reqIdRef.current === myReqId) setOptions([]) })
        .finally(() => { if (reqIdRef.current === myReqId) setLoading(false) })
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(startHandle)
      clearTimeout(handle)
    }
  }, [trimmed, tooShort])

  const hasExactMatch = options.some((o) => (o.name || '').toLowerCase() === trimmed.toLowerCase())

  const augmentedOptions: SupplierOption[] = useMemo(() => {
    if (tooShort || loading || hasExactMatch) return options
    return [...options, { __action: 'create-supplier' as const, __label: t($ => $.supplierPicker.create, { name: trimmed }) }]
  }, [options, tooShort, loading, hasExactMatch, trimmed, t])

  async function createSupplier(name: string) {
    setError(null)
    try {
      const created = await createContact({ name, category: 'supplier' })
      onChange({ supplier_name: created.name ?? '', supplier_contact_id: created.id ?? null })
    } catch {
      try {
        const rows = await searchContacts(name)
        const match = rows.find((r) => (r.name || '').toLowerCase() === name.toLowerCase())
        if (match) onChange({ supplier_name: match.name ?? '', supplier_contact_id: match.id ?? null })
        else setError(t($ => $.supplierPicker.createFailed))
      } catch {
        setError(t($ => $.supplierPicker.createFailed))
      }
    }
  }

  function handleChange(_event: React.SyntheticEvent, picked: SupplierOption | string | null) {
    if (!picked) return
    if (typeof picked === 'string') {
      onChange({ supplier_name: picked, supplier_contact_id: null })
      return
    }
    if (isAction(picked)) {
      createSupplier(trimmed)
      return
    }
    onChange({ supplier_name: picked.name ?? '', supplier_contact_id: picked.id ?? null })
  }

  return (
    <Autocomplete
      freeSolo
      value={value || ''}
      onChange={handleChange}
      inputValue={value || ''}
      onInputChange={(_e, v, reason) => {
        if (reason === 'reset') return
        onChange({ supplier_name: v, supplier_contact_id: null })
      }}
      options={augmentedOptions}
      filterOptions={(x) => x}
      loading={loading}
      disabled={disabled}
      clearText={t($ => $.supplierPicker.clear)}
      openText={t($ => $.supplierPicker.open)}
      loadingText={t($ => $.state.loading, { ns: 'common' })}
      noOptionsText={t($ => $.supplierPicker.noOptions)}
      getOptionLabel={(o) => {
        if (typeof o === 'string') return o
        return isAction(o) ? o.__label : o.name || ''
      }}
      renderOption={(props, option) => {
        if (typeof option === 'string') {
          return <li {...props} key={option}><Typography variant="body2">{option}</Typography></li>
        }
        if (isAction(option)) {
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
              {subtitle && <Typography variant="caption" color="text.secondary">{subtitle}</Typography>}
            </Box>
          </li>
        )
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label ?? t($ => $.labels.supplier)}
          autoFocus={autoFocus}
          placeholder={t($ => $.supplierPicker.placeholder)}
          error={Boolean(error)}
          helperText={error || undefined}
          slotProps={{
            ...params.slotProps,
            input: {
              ...params.slotProps?.input,
              endAdornment: (
                <>
                  <InputAdornment position="end">
                    <SearchIcon fontSize="small" color="action" />
                  </InputAdornment>
                  {(params.slotProps?.input as Record<string, unknown>)?.endAdornment as React.ReactNode}
                </>
              ),
            },
          }}
        />
      )}
    />
  )
}
