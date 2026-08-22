import { randomUUID } from 'node:crypto'
import { withTransaction } from '../../db/withTransaction.js'
import { limitedCollection } from '../../platform/collections/limitedCollectionService.js'
import { badRequest, conflict, notFound } from '../../platform/http/serviceErrors.js'
import { contractPdfKey, getObject, readObjectBuffer, uploadObjectWithQuota } from '../../platform/files/storageService.js'
import { renderGigContractPdf as defaultRenderer } from '../../utils/renderGigContractPdf.js'
import { normalizeDocumentLng } from '../../utils/documentI18n.js'
import { loadTenantLogoBuffer } from '../../utils/tenantLogo.js'
import { fetchProfileTenant } from '../../people/profiles/profileRepository.js'
import { fetchVenue } from '../../people/venues/venueRepository.js'
import { fetchGigWithRelations, listGigCosts } from '../../planning/gigs/gigRepository.js'
import { countersignContractRow, fetchContract, insertContract, listContractRows, lockContractReference, nextContractSequence, nextContractVersion, updateContractPdf, voidContractRow } from './contractRepository.js'

const NOT_FOUND = notFound('Not found')
const GIG_SNAPSHOT_FIELDS = Object.freeze([
  'id', 'venue_id', 'event_description', 'event_date', 'end_date', 'start_time', 'end_time',
  'deal_type', 'guarantee_variant', 'guaranteed_fee_cents', 'percentage_of_sales',
  'breakeven_includes_venue_costs', 'venue_costs_cents',
  'ticket_price_net_cents', 'ticket_price_gross_cents', 'agency_fee_basis',
  'agency_fee_percentage', 'agency_fee_amount_cents', 'commission_basis',
  'commission_percentage', 'commission_amount_cents', 'subject_to_vat', 'vat_percentage',
  'ticket_vat_percentage', 'copyright_percentage',
])
const TENANT_SNAPSHOT_FIELDS = Object.freeze([
  'display_name', 'band_name', 'formal_name', 'address_street', 'address_postal_code',
  'address_city', 'address_country', 'kvk_number', 'tax_id', 'email', 'phone',
])
const VENUE_SNAPSHOT_FIELDS = Object.freeze([
  'id', 'name', 'organization_name', 'street_and_number', 'postal_code', 'city', 'region',
  'country', 'kvk_number', 'tax_id', 'email', 'phone',
])

function pick(source, fields) {
  return Object.fromEntries(fields.map((field) => [field, source?.[field] ?? null]))
}

function contractSnapshot(gig, costs, venue, tenant) {
  return {
    gig: pick(gig, GIG_SNAPSHOT_FIELDS),
    costs: costs.map((cost) => pick(cost, ['label', 'amount_cents', 'paid_by', 'position'])),
    venue: pick(venue, VENUE_SNAPSHOT_FIELDS),
    tenant: pick(tenant, TENANT_SNAPSHOT_FIELDS),
  }
}

export async function generateContract(db, tenantId, userId, gigId, body = {}, { renderer = defaultRenderer } = {}) {
  const locale = normalizeDocumentLng(body.lng)
  const generatedAt = new Date()
  const frozen = await withTransaction(async (client) => {
    const gig = await fetchGigWithRelations(client, gigId, tenantId)
    if (!gig) return NOT_FOUND
    if (!gig.venue_id) return badRequest('The gig needs a venue before a contract can be generated')
    const tenant = await fetchProfileTenant(client, tenantId)
    if (!tenant) return NOT_FOUND
    const costs = await listGigCosts(client, gigId, tenantId)
    const venue = await fetchVenue(client, gig.venue_id, tenantId)
    if (!venue) return NOT_FOUND
    const year = Number(String(gig.event_date).slice(0, 4))
    await lockContractReference(client, tenantId, year)
    const sequence = await nextContractSequence(client, tenantId, year)
    const version = await nextContractVersion(client, tenantId, gigId)
    const reference = `${year}-${String(sequence).padStart(4, '0')}`
    const termsSnapshot = contractSnapshot(gig, costs, venue, tenant)
    const contract = await insertContract(client, tenantId, {
      gigId, reference, version, locale, termsSnapshot, userId,
    })
    return { contract, termsSnapshot, logoTenant: tenant }
  }, { db })
  if (frozen.error) return frozen
  const logoBuffer = await loadTenantLogoBuffer(frozen.logoTenant)
  const pdf = await renderer({
    gig: frozen.termsSnapshot.gig,
    costs: frozen.termsSnapshot.costs,
    venue: frozen.termsSnapshot.venue,
    tenant: frozen.termsSnapshot.tenant,
    logoBuffer,
    bandName: frozen.termsSnapshot.tenant.display_name || frozen.termsSnapshot.tenant.band_name || '',
    reference: frozen.contract.reference,
    version: frozen.contract.version,
    generatedAt,
    lng: locale,
  })
  const key = contractPdfKey(tenantId, randomUUID())
  await uploadObjectWithQuota(key, pdf, pdf.length, 'application/pdf')
  return { contract: await updateContractPdf(db, tenantId, frozen.contract.id, key, pdf.length) }
}

export async function listContracts(db, tenantId, gigId, query = {}) {
  const gig = await fetchGigWithRelations(db, gigId, tenantId)
  if (!gig) return NOT_FOUND
  return limitedCollection(query.limit, (limit) => listContractRows(db, tenantId, gigId, limit))
}
export async function getContract(db, tenantId, contractId) {
  const contract = await fetchContract(db, tenantId, contractId)
  return contract ? { contract } : NOT_FOUND
}
export async function getContractPdf(db, tenantId, contractId) {
  const contract = await fetchContract(db, tenantId, contractId)
  if (!contract) return NOT_FOUND
  if (!contract.pdf_object_key) return conflict('Contract PDF is not available', { code: 'contract_pdf_unavailable' })
  return { contract, stream: await getObject(contract.pdf_object_key) }
}
export async function loadContractAttachment(db, tenantId, contractId) {
  const contract = await fetchContract(db, tenantId, contractId)
  if (!contract?.pdf_object_key) throw Object.assign(new Error('Contract PDF is not available'), { status: 409, code: 'contract_pdf_unavailable' })
  const content = await readObjectBuffer(contract.pdf_object_key)
  return { filename: `contract-${contract.reference}.pdf`, content: content.toString('base64') }
}
export async function countersignContract(db, tenantId, contractId, body = {}) {
  const date = body.date ? new Date(body.date) : new Date()
  if (Number.isNaN(date.getTime())) return badRequest('Invalid countersigned date')
  const contract = await countersignContractRow(db, tenantId, contractId, date, body.note ? String(body.note) : null)
  return contract ? { contract } : NOT_FOUND
}
export async function voidContract(db, tenantId, contractId) {
  const current = await fetchContract(db, tenantId, contractId)
  if (!current) return NOT_FOUND
  if (current.status === 'countersigned') return conflict('A countersigned contract cannot be voided')
  return { contract: await voidContractRow(db, tenantId, contractId) }
}
