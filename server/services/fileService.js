// File-access domain logic. The route owns the HTTP streaming/header concerns;
// this layer resolves whether the active tenant may read an object key and the
// download filename to advertise.
import {
  objectKeyBelongsToTenant,
  fetchOriginalFilename,
  purchaseAttachmentCreatedByUserId,
} from '../repositories/fileRepository.js'

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
