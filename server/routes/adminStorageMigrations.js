import { Router } from 'express'
import {
  getPrivateStorageConnection,
  getStorageMigration,
  getStorageMigrations,
  requestStorageMigration,
  testPrivateStorageConnection,
} from '../services/storageMigrationService.js'
import { validateStorageMigrationAction } from '../validators/storageMigrationValidators.js'
import { auditLog } from '../utils/auditLog.js'
import { requireParam, sendError } from './routeHelpers.js'

const router = Router()

router.get('/connection', async (_req, res) => {
  res.json(await getPrivateStorageConnection())
})

router.post('/connection/test', async (req, res) => {
  const result = await testPrivateStorageConnection()
  auditLog(req, 'storage_migration.connection_test', { connected: result.connected })
  res.json(result)
})

router.get('/tenants', async (_req, res) => {
  res.json(await getStorageMigrations())
})

router.get('/tenants/:id', async (req, res) => {
  const tenantId = requireParam(req, res, 'id'); if (tenantId === null) return
  const migration = await getStorageMigration(tenantId)
  if (!migration) return res.status(404).json({ error: 'Tenant not found' })
  res.json(migration)
})

async function queueAction(req, res, action) {
  const tenantId = requireParam(req, res, 'id'); if (tenantId === null) return
  const validation = validateStorageMigrationAction(action)
  if (validation.error) return sendError(res, validation.error)
  const result = await requestStorageMigration(tenantId, action, req.user.id, req.body)
  if (result.error) return sendError(res, result.error)
  auditLog(req, `storage_migration.${action}`, { tenantId })
  res.status(202).json(result.migration)
}

router.post('/tenants/:id/inventory', (req, res) => queueAction(req, res, 'inventory'))
router.post('/tenants/:id/copy', (req, res) => queueAction(req, res, 'copy'))
router.post('/tenants/:id/validate', (req, res) => queueAction(req, res, 'validate'))
router.post('/tenants/:id/delete-rustfs', (req, res) => queueAction(req, res, 'delete_rustfs'))

export default router
