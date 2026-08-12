import { Router } from 'express'
import {
  getStorageConnection,
  testStorageConnection,
} from '../../platform/files/storageConnectionService.js'
import { auditLog } from '../../utils/auditLog.js'

const router = Router()

router.get('/connection', async (_req, res) => {
  res.json(await getStorageConnection())
})

router.post('/connection/test', async (req, res) => {
  const result = await testStorageConnection()
  auditLog(req, 'storage.connection_test', { connected: result.connected })
  res.json(result)
})

export default router
