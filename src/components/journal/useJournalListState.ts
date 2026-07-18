import { useCallback, useEffect, useRef, useState } from 'react'
import {
  listJournals,
  createJournal,
  deleteJournal,
  approveJournals,
} from '../../api/journal.ts'
import { listAccounts, getAccountingSettings } from '../../api/accounts.ts'
import type { Journal, Account, AccountingSettings, Id } from '../../types/entities.ts'
import type { SaveStatus } from '../../hooks/useDebouncedSave.ts'
import { emptyLine } from './journalFormHelpers.ts'
import type { JournalForm } from './journalFormHelpers.ts'

type FlushFn = () => Promise<void>

interface UseJournalListStateResult {
  journals: Journal[]
  accounts: Account[]
  accountingSettings: AccountingSettings | null
  loading: boolean
  error: string | null
  approvalErrors: Array<{ id: Id; ok: boolean; message?: string }>
  clearApprovalErrors: () => void
  selected: Set<Id>
  draftIds: Id[]
  liveForms: Map<Id, JournalForm>
  registerFlush: (id: Id, fn: FlushFn | null) => void
  reportForm: (id: Id, form: JournalForm | null) => void
  reportSaveStatus: (id: Id, status: SaveStatus | null) => void
  saveStatus: SaveStatus
  toggleSelect: (id: Id, checked: boolean) => void
  selectAll: (checked: boolean) => void
  addEntry: () => Promise<void>
  approveAll: () => Promise<void>
  approveSelected: () => Promise<void>
  deleteSelected: () => Promise<void>
}

// Owns the journal list: loads journals + the active chart of accounts, tracks
// selection, and runs the add / delete / approve lifecycle. Each entry row
// registers its debounced-save `flush` here so approving can persist pending
// edits first (useDebouncedSave does not flush on unmount).
export function useJournalListState(): UseJournalListStateResult {
  const [journals, setJournals] = useState<Journal[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountingSettings, setAccountingSettings] = useState<AccountingSettings | null>(null)
  const [liveForms, setLiveForms] = useState<Map<Id, JournalForm>>(() => new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [approvalErrors, setApprovalErrors] = useState<Array<{ id: Id; ok: boolean; message?: string }>>([])
  const [selected, setSelected] = useState<Set<Id>>(() => new Set())
  const [saveStatuses, setSaveStatuses] = useState<Map<Id, SaveStatus>>(() => new Map())
  const flushers = useRef<Map<Id, FlushFn>>(new Map())

  const clearApprovalErrors = useCallback(() => setApprovalErrors([]), [])

  const registerFlush = useCallback((id: Id, fn: FlushFn | null) => {
    if (fn) flushers.current.set(id, fn)
    else flushers.current.delete(id)
  }, [])

  // Rows report their live (possibly unsaved) form state here so the page can
  // preview the ledger effects of the current selection as the user types.
  const reportForm = useCallback((id: Id, form: JournalForm | null) => {
    setLiveForms((prev) => {
      if ((prev.get(id) ?? null) === form) return prev
      const next = new Map(prev)
      if (form === null) next.delete(id)
      else next.set(id, form)
      return next
    })
  }, [])

  // Rows report their useDebouncedSave status here so the page can show one
  // save indicator in the toolbar instead of per-row text that shifts layout.
  const reportSaveStatus = useCallback((id: Id, status: SaveStatus | null) => {
    setSaveStatuses((prev) => {
      if ((prev.get(id) ?? null) === status) return prev
      const next = new Map(prev)
      if (status === null) next.delete(id)
      else next.set(id, status)
      return next
    })
  }, [])

  const statuses = new Set(saveStatuses.values())
  let saveStatus: SaveStatus = 'idle'
  if (statuses.has('saving')) saveStatus = 'saving'
  else if (statuses.has('error')) saveStatus = 'error'

  const flushIds = useCallback(async (ids: Id[]) => {
    await Promise.all(ids.map((id) => flushers.current.get(id)?.()).filter(Boolean))
  }, [])

  // The journal must never be empty: there should always be at least one draft
  // ready to edit. Creates a fresh blank draft (one empty line) for the tenant.
  const createBlankDraft = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10)
    return createJournal({ entry_date: today, description: undefined, lines: [emptyLine(0)] })
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
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
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
    // Settings are only needed to route the VAT split in the effects preview;
    // without them the preview keeps VAT on the line account.
    getAccountingSettings()
      .then((s) => { if (!cancelled) setAccountingSettings(s) })
      .catch(() => { /* best-effort; leave settings null */ })
    return () => { cancelled = true }
  }, [])

  const draftIds = journals.filter((j) => j.status === 'draft').map((j) => j.id as Id)

  const toggleSelect = useCallback((id: Id, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id); else next.delete(id)
      return next
    })
  }, [])

  const selectAll = useCallback((checked: boolean) => {
    setSelected(checked ? new Set(draftIds) : new Set())
  }, [draftIds.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  const addEntry = useCallback(async () => {
    try {
      await createBlankDraft()
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [createBlankDraft, load])

  // Flushes pending edits for the given drafts, posts them in one batch, then
  // reloads. Per-entry approval failures (invalid/unbalanced lines, missing
  // accounting config) surface via `approvalErrors` so the page can show a dialog.
  const approveIds = useCallback(async (ids: Id[]) => {
    if (!ids.length) return
    try {
      setError(null)
      await flushIds(ids)
      const { results } = await approveJournals(ids)
      const failed = (results || []).filter((r) => !r.ok)
      setApprovalErrors(failed)
      setSelected(new Set())
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
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
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [selected, load])

  return {
    journals, accounts, accountingSettings, loading, error,
    approvalErrors, clearApprovalErrors,
    selected, draftIds, liveForms,
    registerFlush, reportForm, reportSaveStatus, saveStatus,
    toggleSelect, selectAll,
    addEntry, approveAll, approveSelected, deleteSelected,
  }
}
