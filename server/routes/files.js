import { Router } from 'express'
import { requireApproved } from '../middleware/auth.js'
import { storageClient, BUCKET } from '../utils/storage.js'

const router = Router()

router.get('/*objectKey', requireApproved, async (req, res) => {
  const segments = req.params.objectKey
  const objectKey = Array.isArray(segments) ? segments.join('/') : segments

  if (!objectKey) return res.status(400).json({ error: 'Missing object key' })

  try {
    const stat = await storageClient.statObject(BUCKET, objectKey)
    res.setHeader('Content-Type', stat.metaData?.['content-type'] || 'application/octet-stream')
    res.setHeader('Content-Length', stat.size)
    const stream = await storageClient.getObject(BUCKET, objectKey)
    stream.pipe(res)
  } catch (err) {
    if (err.code === 'NoSuchKey' || err.message?.includes('Not Found')) {
      return res.status(404).json({ error: 'Not found' })
    }
    throw err
  }
})

export default router
