import { Router } from 'express'
import multer from 'multer'
import pool from '../db/index.js'
import { requirePermission } from '../middleware/permissions.js'
import { PERMISSIONS } from '../auth/permissions.js'
import { requireEntitlement } from '../middleware/entitlements.js'
import { FEATURES } from '../auth/entitlements.js'
import { requireParam, sendError } from './routeHelpers.js'
import {
  listInvoices,
  listInvoicesForGig,
  listInvoicePeriods,
  searchInvoices,
  searchInvoiceGigs,
  buildDraftFromGig,
  getInvoice,
  createInvoice,
  patchInvoice,
  deleteInvoice,
  retryRenderPdf,
  uploadInvoiceLogo,
  removeInvoiceLogo,
  createInvoicePaymentLink,
  removeInvoicePaymentLink,
  syncInvoicePaymentLink,
} from '../services/invoiceService.js'
import { getEmlDefaults, buildInvoiceEml } from '../services/invoiceEmailService.js'

const router = Router()

const LOGO_ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
})

// List invoices (optionally filtered to a period)
router.get('/', async (req, res) => {
  const result = await listInvoices(pool, req.tenantId, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result.invoices)
})

// Distinct issue dates (for the period filter)
router.get('/periods', async (req, res) => {
  res.json(await listInvoicePeriods(pool, req.tenantId))
})

// Global search (min 3 chars): invoice number or customer name. The whole
// router is already finance-gated. Must precede /:id.
router.get('/search', async (req, res) => {
  res.json(await searchInvoices(pool, req.tenantId, req.query))
})

// Bounded search for the new-invoice gig picker. Includes whether each gig is
// already linked to an invoice so the UI can show it without allowing selection.
router.get('/gig-search', async (req, res) => {
  res.json(await searchInvoiceGigs(pool, req.tenantId, req.query))
})

// Pre-filled invoice draft from a gig
router.get('/draft-from-gig/:gigId', async (req, res) => {
  const gigId = requireParam(req, res, 'gigId'); if (gigId === null) return
  const result = await buildDraftFromGig(pool, req.tenantId, gigId)
  if (result.error) return sendError(res, result.error)
  res.json(result.draftResponse)
})

// Active invoices (draft/sent/paid) linked to a gig — the gig Terms tab. Must
// precede /:id so "by-gig" isn't parsed as an invoice id.
router.get('/by-gig/:gigId', async (req, res) => {
  const gigId = requireParam(req, res, 'gigId'); if (gigId === null) return
  const result = await listInvoicesForGig(pool, req.tenantId, gigId)
  if (result.error) return sendError(res, result.error)
  res.json(result.invoices)
})

// Get single invoice with lines and tenant
router.get('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await getInvoice(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.json(result.invoice)
})

// Create invoice
router.post('/', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res) => {
  const result = await createInvoice(pool, req.tenantId, req.user.id, req.body || {})
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.invoice)
})

// Update invoice (partial)
router.patch('/:id', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await patchInvoice(pool, req.tenantId, id, req.body || {}, req.user.id)
  if (result.error) return sendError(res, result.error)
  res.json(result.invoice)
})

// Delete invoice (drafts only)
router.delete('/:id', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await deleteInvoice(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

// Retry PDF render
router.post('/:id/render', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await retryRenderPdf(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.json({ pdf_path: result.pdf_path })
})

// Upload custom logo
router.post('/:id/logo', requirePermission(PERMISSIONS.FINANCE_MANAGE), logoUpload.single('logo'), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  if (!LOGO_ALLOWED_TYPES.has(req.file.mimetype)) {
    return res.status(400).json({ error: 'File type not allowed' })
  }
  const result = await uploadInvoiceLogo(pool, req.tenantId, id, req.file)
  if (result.error) return sendError(res, result.error)
  res.json({ custom_logo_path: result.custom_logo_path })
})

// Remove custom logo
router.delete('/:id/logo', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await removeInvoiceLogo(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

// Create payment link (finalizes the invoice). Issuing NEW Mollie links uses
// the tenant's integration credentials → integrations entitlement required.
// Removing a link and syncing an existing one deliberately stay open: cleanup
// must not be trapped by a downgrade, and already-issued links must keep
// settling (the public webhook is unauthenticated anyway).
router.post('/:id/payment-link', requirePermission(PERMISSIONS.FINANCE_MANAGE), requireEntitlement(FEATURES.INTEGRATIONS), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await createInvoicePaymentLink(pool, req.tenantId, id, req.user.id, req.body || {})
  if (result.error) return sendError(res, result.error)
  res.status(result.created ? 201 : 200).json(result.invoice)
})

// Remove payment link
router.delete('/:id/payment-link', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await removeInvoicePaymentLink(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.json(result.invoice)
})

// Sync payment status from Mollie
router.post('/:id/payment-link/sync', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await syncInvoicePaymentLink(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.json(result.sync)
})

// Pre-filled defaults for the email compose dialog
router.get('/:id/eml-defaults', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await getEmlDefaults(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.json(result.defaults)
})

// Generates and streams the .eml file.
router.post('/:id/eml', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await buildInvoiceEml(pool, req.tenantId, id, req.body?.personalMessage)
  if (result.error) return sendError(res, result.error)
  res.setHeader('Content-Type', 'message/rfc822')
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`)
  res.send(result.content)
})

export { syncInvoicePaymentStatus } from '../services/molliePaymentLinkService.js'
export default router
