// File-access domain logic. The route owns the HTTP streaming/header concerns;
// this layer resolves whether the active tenant may read an object key and the
// download filename to advertise.
import {
  objectKeyBelongsToTenant,
  fetchOriginalFilename,
  purchaseAttachmentCreatedByUserId,
  searchFiles as searchFileRows,
} from '../repositories/fileRepository.js'

// Per-attachment-kind display label and the detail route of its owning entity.
const FILE_KINDS = {
  gig_attachment: { label: 'Gig attachment', route: (id) => `/gigs/${id}` },
  song_document: { label: 'Sheet music', route: (id) => `/songs/${id}` },
  song_recording: { label: 'Recording', route: (id) => `/songs/${id}` },
  purchase_attachment: { label: 'Purchase receipt', route: (id) => `/purchases/${id}` },
}

// Clamp a requested search result limit to a sane range (default 10, max 25).
function parseSearchLimit(value) {
  const parsedLimit = Number.parseInt(value, 10)
  return Math.max(1, Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 10, 25))
}

// Global-search read: matches uploaded files by filename and resolves each to a
// link to its owning gig/song/purchase. Short queries (<3 chars) return nothing
// so we don't scan on every keystroke (mirrors the other category searches).
// `caller` carries the finance capability flags so purchase receipts only
// surface to those allowed to read them (see searchFiles in fileRepository).
export async function searchFiles(db, tenantId, query, caller) {
  const q = String(query.q ?? '').trim()
  if (q.length < 3) return []
  const rows = await searchFileRows(db, tenantId, `%${q}%`, parseSearchLimit(query.limit), caller)
  return rows.map((row) => {
    const kind = FILE_KINDS[row.kind]
    return {
      id: `${row.kind}-${row.row_id}`,
      filename: row.original_filename,
      kind: kind.label,
      to: kind.route(row.parent_id),
    }
  })
}

// Returns { allowed, originalFilename }. originalFilename is only loaded when
// access is granted, and is null for object types without a stored name.
export async function resolveFileAccess(db, tenantId, objectKey) {
  const allowed = await objectKeyBelongsToTenant(db, tenantId, objectKey)
  if (!allowed) return { allowed: false, originalFilename: null }
  return { allowed: true, originalFilename: await fetchOriginalFilename(db, objectKey, tenantId) }
}

// The category segment of `tenants/<id>/<category>/<uuid>` keys that hold
// financial documents. Access to these is gated by finance.view (with an
// own-purchase exception for receipts under purchase.create).
const FINANCE_FILE_CATEGORIES = new Set(['invoices', 'purchase_attachments'])

function objectKeyCategory(objectKey) {
  return objectKey.split('/')[2] ?? ''
}

// Capability gate for financial file objects (called after tenant ownership is
// confirmed). `caller` = { canFinanceView, canPurchaseCreate, userId }. Returns
// true for non-finance keys; for finance keys requires finance.view, except a
// purchase receipt the caller created is allowed under purchase.create.
export async function canReadFinanceFile(db, tenantId, objectKey, caller) {
  const category = objectKeyCategory(objectKey)
  if (!FINANCE_FILE_CATEGORIES.has(category)) return true
  if (caller.canFinanceView) return true
  if (category === 'purchase_attachments' && caller.canPurchaseCreate) {
    const ownerId = await purchaseAttachmentCreatedByUserId(db, tenantId, objectKey)
    return ownerId != null && ownerId === caller.userId
  }
  return false
}
