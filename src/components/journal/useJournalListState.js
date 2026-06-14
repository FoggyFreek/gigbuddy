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
  const [saveStatuses, setSaveStatuses] = useState(() => new Map())
  const flushers = useRef(new Map())

  const clearApprovalErrors = useCallback(() => setApprovalErrors([]), [])

  const registerFlush = useCallback((id, fn) => {
    if (fn) flushers.current.set(id, fn)
    else flushers.current.delete(id)
  }, [])

  // Rows report their useDebouncedSave status here so the page can show one
  // save indicator in the toolbar instead of per-row text that shifts layout.
  const reportSaveStatus = useCallback((id, status) => {
    setSaveStatuses((prev) => {
      if ((prev.get(id) ?? null) === status) return prev
      const next = new Map(prev)
      if (status === null) next.delete(id)
      else next.set(id, status)
      return next
    })
  }, [])

  const statuses = new Set(saveStatuses.values())
  let saveStatus = 'idle'
  if (statuses.has('saving')) saveStatus = 'saving'
  else if (statuses.has('error')) saveStatus = 'error'

  const flushIds = useCallback(async (ids) => {
    await Promise.all(ids.map((id) => flushers.current.get(id)?.()).filter(Boolean))
  }, [])

  // The journal must never be empty: there should always be at least one draft
  // ready to edit. Creates a fresh blank draft (one empty line) for the tenant.
  const createBlankDraft = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10)
    return createJournal({ entry_date: today, description: null, lines: [emptyLine(0)] })
  }, [])

  // Loads the drafts and, if none exist (first visit, or after approving/deleting
  // them all), seeds one blank draft and re-fetches once so the editor always has
  // a row. The single guarded `if` (no loop) keeps a still-empty re-fetch safe.
  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      let data = await listJournals()
      if (!data.length) {
        await createBlankDraft()
        data = await listJournals()
      }
      setJournals(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [createBlankDraft])

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
      await createBlankDraft()
      await load()
    } catch (e) {
      setError(e.message)
    }
  }, [createBlankDraft, load])

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
    registerFlush, reportSaveStatus, saveStatus,
    toggleSelect, selectAll,
    addEntry, approveAll, approveSelected, deleteSelected,
  }
}
