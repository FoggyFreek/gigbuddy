// "Don't show this message again" persistence. Keyed by dialog id, so a shipped
// id must never be renamed — the stored preference would be orphaned and the
// dialog would come back.
//
// localStorage is the source of truth (per browser, not per user); these are UX
// preferences, never access decisions.
const KEY = 'gigbuddy_suppressed_dialogs'

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function write(ids: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids))
  } catch {
    // A full or unavailable store only costs the preference — never the dialog.
  }
}

export function isDialogSuppressed(id: string): boolean {
  return read().includes(id)
}

export function suppressDialog(id: string) {
  const ids = read()
  if (!ids.includes(id)) write([...ids, id])
}

export function resetDialogSuppression(id?: string) {
  if (id === undefined) write([])
  else write(read().filter((stored) => stored !== id))
}
