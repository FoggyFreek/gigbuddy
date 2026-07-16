import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { SyntheticEvent } from 'react'
import type { AutocompleteInputChangeReason } from '@mui/material/Autocomplete'

const DEFAULT_MIN_CHARS = 3
const DEFAULT_DEBOUNCE_MS = 250

interface UseRemoteSearchOptions<T> {
  search: (query: string) => Promise<T[]>
  enabled?: boolean
  minChars?: number
  debounceMs?: number
  dependencyKey?: string
  filterResults?: (rows: T[]) => T[]
  inputValue?: string
  onInputValueChange?: (value: string) => void
}

interface SearchResult<T> {
  key: string | null
  options: T[]
}

export default function useRemoteSearch<T>({
  search,
  enabled = true,
  minChars = DEFAULT_MIN_CHARS,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  dependencyKey = '',
  filterResults,
  inputValue: controlledInputValue,
  onInputValueChange,
}: UseRemoteSearchOptions<T>) {
  const [internalInputValue, setInternalInputValue] = useState('')
  const [internalQuery, setInternalQuery] = useState('')
  const [result, setResult] = useState<SearchResult<T>>({ key: null, options: [] })
  const requestIdRef = useRef(0)
  const runSearch = useEffectEvent(async (searchQuery: string) => {
    const rows = await search(searchQuery)
    return filterResults?.(rows) ?? rows
  })

  const controlled = controlledInputValue !== undefined
  const inputValue = controlled ? controlledInputValue : internalInputValue
  const query = controlled ? controlledInputValue : internalQuery
  const trimmedQuery = query.trim()
  const tooShort = trimmedQuery.length < minChars
  const searchKey = enabled && !tooShort
    ? `${dependencyKey}\u0000${trimmedQuery}`
    : null

  useEffect(() => {
    const requestId = ++requestIdRef.current
    if (searchKey === null) return

    const handle = setTimeout(() => {
      runSearch(trimmedQuery)
        .then((options) => {
          if (requestIdRef.current !== requestId) return
          setResult({ key: searchKey, options })
        })
        .catch(() => {
          if (requestIdRef.current !== requestId) return
          setResult({ key: searchKey, options: [] })
        })
    }, debounceMs)

    return () => {
      clearTimeout(handle)
      if (requestIdRef.current === requestId) requestIdRef.current += 1
    }
  }, [debounceMs, searchKey, trimmedQuery])

  function handleInputChange(
    _event: SyntheticEvent | null,
    value: string,
    reason: AutocompleteInputChangeReason,
  ) {
    if (controlled) {
      if (reason !== 'reset') onInputValueChange?.(value)
      return
    }

    if (reason === 'input') {
      setInternalInputValue(value)
      setInternalQuery(value)
    } else if (reason === 'reset') {
      setInternalInputValue(value)
    } else if (reason === 'clear') {
      setInternalInputValue('')
      setInternalQuery('')
    }
  }

  function clear() {
    if (controlled) {
      onInputValueChange?.('')
      return
    }
    setInternalInputValue('')
    setInternalQuery('')
  }

  function clearQuery() {
    if (controlled) {
      onInputValueChange?.('')
      return
    }
    setInternalQuery('')
  }

  const hasCurrentResult = searchKey !== null && result.key === searchKey

  return {
    inputValue,
    query: trimmedQuery,
    options: hasCurrentResult ? result.options : [],
    loading: searchKey !== null && !hasCurrentResult,
    tooShort,
    minChars,
    onInputChange: handleInputChange,
    clear,
    clearQuery,
  }
}
