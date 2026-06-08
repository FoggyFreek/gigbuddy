import { useEffect, useMemo, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import InputAdornment from '@mui/material/InputAdornment'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import SearchIcon from '@mui/icons-material/Search'
import { createContact, searchContacts } from '../../api/contacts.js'

const MIN_CHARS = 3
const DEBOUNCE_MS = 250

// Supplier field: searches contacts, lets the user free-type a name, and offers
// to silently create a 'supplier' contact when nothing matches. Because
// _client.request drops the status/code on a non-401 error, a failed create
// falls back to re-searching and selecting an exact match rather than reading
// the error shape.
export default function SupplierAutocomplete({
  value, onChange, disabled, autoFocus, label = 'Supplier',
}) {
  const [options, setOptions] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const reqIdRef = useRef(0)

  const trimmed = (value || '').trim()
  const tooShort = trimmed.length < MIN_CHARS

  useEffect(() => {
    const myReqId = ++reqIdRef.current
    if (tooShort) {
      // Defer the reset to a microtask so it isn't a synchronous setState in the
      // effect body (mirrors ContactPicker).
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

  const augmentedOptions = useMemo(() => {
    if (tooShort || loading || hasExactMatch) return options
    return [...options, { __action: 'create-supplier', __label: `+ Add '${trimmed}' as supplier` }]
  }, [options, tooShort, loading, hasExactMatch, trimmed])

  async function createSupplier(name) {
    setError(null)
    try {
      const created = await createContact({ name, category: 'supplier' })
      onChange({ supplier_name: created.name, supplier_contact_id: created.id })
    } catch {
      // Create failed (likely a duplicate). Re-search and pick the exact match.
      try {
        const rows = await searchContacts(name)
        const match = rows.find((r) => (r.name || '').toLowerCase() === name.toLowerCase())
        if (match) onChange({ supplier_name: match.name, supplier_contact_id: match.id })
        else setError('Could not add supplier')
      } catch {
        setError('Could not add supplier')
      }
    }
  }

  function handleChange(_event, picked) {
    if (!picked) return
    if (typeof picked === 'string') {
      onChange({ supplier_name: picked, supplier_contact_id: null })
      return
    }
    if (picked.__action === 'create-supplier') {
      createSupplier(trimmed)
      return
    }
    onChange({ supplier_name: picked.name, supplier_contact_id: picked.id })
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
      getOptionLabel={(o) => {
        if (typeof o === 'string') return o
        return o.__action ? o.__label : o.name || ''
      }}
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
              {subtitle && <Typography variant="caption" color="text.secondary">{subtitle}</Typography>}
            </Box>
          </li>
        )
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          autoFocus={autoFocus}
          placeholder="Search or type contact name…"
          error={Boolean(error)}
          helperText={error || undefined}
          slotProps={{
            // MUI v9: {...params} already supplies a `slotProps` (its `htmlInput`
            // slot carries the input ref). Spread the whole thing first so we
            // don't drop the ref, then extend just the `input` slot's adornment.
            ...params.slotProps,
            input: {
              ...params.slotProps?.input,
              endAdornment: (
                <>
                  <InputAdornment position="end">
                    <SearchIcon fontSize="small" color="action" />
                  </InputAdornment>
                  {params.slotProps?.input?.endAdornment}
                </>
              ),
            },
          }}
        />
      )}
    />
  )
}

SupplierAutocomplete.propTypes = {
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  autoFocus: PropTypes.bool,
  label: PropTypes.string,
}
