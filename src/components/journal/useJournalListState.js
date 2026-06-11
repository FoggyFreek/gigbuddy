import { useCallback, useEffect, useRef, useState } from 'react'
import {
  listJournals,
  createJournal,
  deleteJournal,
  approveJournals,
} from '../../api/journal.js'
import { listAccounts } from '../../api/accounts.js'
import { emptyLine } from './journalFormHelpers.js'

// Owns the journal list: loads journals + the active chart of accounts, tracks
// selection, and runs the add / delete / approve lifecycle. Each entry row
// registers its debounced-save `flush` here so approving can persist pending
// edits first (useDebouncedSave does not flush on unmount).
export function useJournalListState() {
  const [journals, setJournals] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [approvalErrors, setApprovalErrors] = useState([])
  const [selected, setSelected] = useState(() => new Set())
  const flushers = useRef(new Map())

  const clearApprovalErrors = useCallback(() => setApprovalErrors([]), [])

  const registerFlush = useCallback((id, fn) => {
    if (fn) flushers.current.set(id, fn)
    else flushers.current.delete(id)
  }, [])

  const flushIds = useCallback(async (ids) => {
    await Promise.all(ids.map((id) => flushers.current.get(id)?.()).filter(Boolean))
  }, [])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await listJournals()
      setJournals(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    let cancelled = false
    listAccounts()
      .then((all) => { if (!cancelled) setAccounts((all || []).filter((a) => a.is_active)) })
      .catch(() => { /* best-effort; leave accounts empty */ })
    return () => { cancelled = true }
  }, [])

  const draftIds = journals.filter((j) => j.status === 'draft').map((j) => j.id)

  const toggleSelect = useCallback((id, checked) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id); else next.delete(id)
      return next
    })
  }, [])

  const selectAll = useCallback((checked) => {
    setSelected(checked ? new Set(draftIds) : new Set())
  }, [draftIds.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  const addEntry = useCallback(async () => {
    try {
      const today = new Date().toISOString().slice(0, 10)
      await createJournal({ entry_date: today, description: null, lines: [emptyLine(0)] })
      await load()
    } catch (e) {
      setError(e.message)
    }
  }, [load])

  // Flushes pending edits for the given drafts, posts them in one batch, then
  // reloads. Per-entry approval failures (invalid/unbalanced lines, missing
  // accounting config) surface via `approvalErrors` so the page can show a dialog.
  const approveIds = useCallback(async (ids) => {
    if (!ids.length) return
    try {
      setError(null)
      await flushIds(ids)
      const { results } = await approveJournals(ids)
      const failed = (results || []).filter((r) => !r.ok)
      setApprovalErrors(failed)
      setSelected(new Set())
      await load()
    } catch (e) {
      setError(e.message)
    }
  }, [flushIds, load])

  const approveAll = useCallback(() => approveIds(draftIds), [approveIds, draftIds])
  const approveSelected = useCallback(() => approveIds([...selected]), [approveIds, selected])

  const deleteSelected = useCallback(async () => {
    const ids = [...selected]
    if (!ids.length) return
    try {
      setError(null)
      await Promise.all(ids.map((id) => deleteJournal(id)))
      setSelected(new Set())
      await load()
    } catch (e) {
      setError(e.message)
    }
  }, [selected, load])

  return {
    journals, accounts, loading, error,
    approvalErrors, clearApprovalErrors,
    selected, draftIds,
    registerFlush,
    toggleSelect, selectAll,
    addEntry, approveAll, approveSelected, deleteSelected,
  }
}
