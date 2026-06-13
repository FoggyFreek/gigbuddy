// File-access domain logic. The route owns the HTTP streaming/header concerns;
// this layer resolves whether the active tenant may read an object key and the
// download filename to advertise.
import {
  objectKeyBelongsToTenant,
  fetchOriginalFilename,
} from '../repositories/fileRepository.js'

// Returns { allowed, originalFilename }. originalFilename is only loaded when
// access is granted, and is null for object types without a stored name.
export async function resolveFileAccess(db, tenantId, objectKey) {
  const allowed = await objectKeyBelongsToTenant(db, tenantId, objectKey)
  if (!allowed) return { allowed: false, originalFilename: null }
  return { allowed: true, originalFilename: await fetchOriginalFilename(db, objectKey, tenantId) }
}
