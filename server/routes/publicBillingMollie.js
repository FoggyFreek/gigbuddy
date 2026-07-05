// Public payment-provider webhook for platform billing. Mounted at
// /api/public/billing (before CSRF/auth, rate-limited) in routes/index.js.
//
// Discipline mirrors publicMollie.js: router-local urlencoded parser, always
// respond 200 (the provider retries on non-2xx), the posted id is only a "go
// check now" hint — status is authoritatively re-fetched from the provider and
// the payment's customer is verified against the subscription owner inside
// ingestProviderPayment, so a guessed subscription id can't forge an outcome.
import { Router, urlencoded } from 'express'
import { ingestProviderPayment } from '../services/paymentIngestionService.js'
import { logger } from '../utils/logger.js'

const router = Router()

router.use(urlencoded({ extended: false }))

router.post('/mollie/webhook', async (req, res) => {
  const paymentId = req.body?.id ?? req.query?.id ?? null
  const subId = req.query?.subscription ? Number(req.query.subscription) : null

  if (!paymentId || !subId || !Number.isInteger(subId) || subId <= 0) {
    return res.status(200).end()
  }

  try {
    await ingestProviderPayment(subId, String(paymentId))
  } catch (err) {
    logger.error('billing.webhook_failed', { err, subscriptionId: subId })
  }
  res.status(200).end()
})

export default router
