import { limitedCollection } from '../../platform/collections/limitedCollectionService.js'
import { badRequest, notFound } from '../../platform/http/serviceErrors.js'
import { addSuppressionRow, deleteSuppressionRow, listSuppressionRows } from './sendRepository.js'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const listSuppressions = (db, tenantId, query = {}) => limitedCollection(query.limit, (limit) => listSuppressionRows(db, tenantId, limit))
export async function addSuppression(db, tenantId, body) {
  const email = String(body.email ?? '').trim().toLowerCase()
  if (!EMAIL.test(email)) return badRequest('A valid email address is required')
  return { suppression: await addSuppressionRow(db, tenantId, email, 'manual') }
}
export async function deleteSuppression(db, tenantId, id) {
  return (await deleteSuppressionRow(db, tenantId, id)) ? {} : notFound('Not found')
}
