# Outreach templates, campaigns, and gig documents

Outreach is a tenant-scoped promotion feature. A template belongs to a **context** that decides
which merge fields it may use: `venue` for venue-facing outreach, `invoice` for the email that
accompanies an invoice. Existing templates and campaign history remain readable after a
subscription downgrade, while mutation and dispatch require the `outreach` entitlement and
`PLANNING_WRITE` — except invoice email, which is transactional and gated on `FINANCE_MANAGE`
alone.

Gig contracts are live generated documents owned by the gig rather than the template
system. Downloading one requires `FINANCE_VIEW`.

## Architecture

- `shared/outreachFields.js` is the merge-field catalogue and `shared/outreachContexts.js` maps
  each context to the field scopes it may use. Add new fields to the catalogue and the raw
  resolver; formatting, permission filtering, editor menus, and previews consume them through
  `fieldsForContext(context)`.
- A field is **required** by default. Optional fields (`message`, `invoice.payment_block`,
  `invoice.payment_url`, the gig-derived ones) merge to nothing when empty; an empty *required*
  field still skips the recipient.
- A template's context is fixed at creation. It is not in `EDITABLE_FIELDS`, and a PATCH that
  carries one is rejected — the field vocabulary must not shift under an authored body. Tokens are
  validated server-side against the context on create *and* update; filtering the editor's field
  menu is UX, not enforcement.
- Merge processing is staged: resolve raw values, format for locale, render registered
  blocks, then merge. Text that needs real markup (the sender's custom message, the payment
  callout) must be a **block**: blocks are substituted after the HTML escape pass, and the block
  renderer escapes its own input.
- Template JSON is the editable source. Rendered HTML and text are stored with it because
  React Email composition requires the live browser editor. A campaign freezes both before
  recipients are reviewed or sent.
- A one-recipient message and a bulk campaign use the same campaign model, discriminated by
  `outreach_campaigns.type` (`outreach` | `invoice`). The batch dispatcher chunks at 100
  recipients; the single dispatcher is the only attachment-capable path.
- A contract PDF is rendered on demand by `server/utils/renderGigContractPdf.js` from the
  current gig, venue, tenant and cost facts. It is sent directly to the browser and is not stored
  or attached to outreach campaigns.

## Invoice email

- The body comes from an `invoice`-context template; nothing about the email is hardcoded. Which
  template is used follows from what exists: none is an error the UI turns into "create one
  first", one is used silently, and several are offered as a picker defaulting to the most
  recently edited. There is no tenant-level default setting.
- Language follows the **selected template's** locale, not the supplier's VAT country (which
  governs the statutory PDF). Strings live in `server/i18n/<lng>/invoiceEmail.json` behind
  `server/utils/invoiceEmailI18n.js`. That i18n instance interpolates **unescaped**, so callers
  escape their own values.
- Content and attachments are resolved separately: `resolveInvoiceEmailContent` is pure and feeds
  the preview, the `.eml` and the send alike, while `materializeInvoiceAttachments` fetches the
  PDF and renders the QR only for the two that actually deliver. The preview inlines the QR as a
  `data:` URL, because `cid:` cannot resolve inside the preview iframe.
- Attachments are `pdf`, `pdf_xml`, or `pdf_xml_embedded`; the XML comes from the existing
  `buildInvoiceUbl`. Blocking Peppol warnings are advisory and never stop a send, matching the
  `/ubl` download. A missing or unreadable PDF **is** fatal (409 `invoice_pdf_unavailable`) — an
  invoice email without its invoice is never shipped.
- **Invoice mail deliberately bypasses suppressions and sends no `List-Unsubscribe` headers.** A
  marketing opt-out must not withhold a legally required document.
- Sending is **create then send**: `POST /email/campaign` returns a campaign id that
  `POST /email/send` dispatches. A retried send reuses the same recipient idempotency key and is
  stopped by an atomic claim, so a lost response cannot deliver the invoice twice. Marking an
  invoice as sent stays on `PATCH /api/invoices/:id`, which owns finalization and the ledger
  posting; an invoice may be emailed any number of times, whatever its status.

## HTTP surface

- `/api/outreach/fields?context=`
- `/api/outreach/templates[/:id]?context=`
- `/api/outreach/sender`
- `/api/outreach/campaigns[/:id]?type=` and `/:id/send`
- `/api/outreach/campaigns/suppressions/list[/:id]`
- `/api/invoices/:id/email/defaults`, `/email/preview`, `/email/campaign`, `/email/send`, `/eml`
- `/api/gigs/:gigId/contract.pdf`

All list endpoints are bounded and all repository queries include `tenant_id`. Both send
endpoints are rate-limited per tenant. Provider calls use deterministic idempotency keys and
record each recipient independently, so a mixed provider response becomes `partial` rather
than rolling back successful deliveries.

## Where things live in the UI

Settings → Integrations → Resend has an **Email activity** button next to the credential
everything was sent with. It opens one dialog with a toggle at the top:

- **Email log** — every send, newest first, filterable by type; select a row for its recipients
  and delivery errors.
- **Suppressions** — addresses outreach must never mail again, with the reminder that invoices are
  transactional and reach a suppressed address anyway.

Both are browsing surfaces rather than settings, so they are a dialog rather than more rows in the
integrations list. `/outreach/campaigns` and its page are gone; the composer returns to the
templates list after a send. The templates list shows each template's context, since venue and
invoice templates share it and offer different merge fields. Emailing an invoice is its own action
on the invoice, not a download: the download menu holds reads only.

## Deployment

Apply all pending migrations before deploying the application. Migration 207 queues legacy
contract PDFs for storage cleanup and removes the versioned contract schema. Migration 208 adds
the template context and the campaign type/invoice/attachments columns; every column is additive
with a default, so the previous app container keeps serving during the migration. The deprecated
`GET /api/invoices/:id/eml-defaults` alias exists for that same window and can be dropped a
deploy later.

Configure a tenant Resend API key first, then save a sender identity in Settings. Suppressions are
checked again immediately before every outreach dispatch; outreach email includes list-unsubscribe
headers.

## Verification

Run:

```powershell
npm.cmd run type-check
npm.cmd run lint
npm.cmd test -- --run src/promotion/outreach/__tests__ src/finance/invoices/__tests__
infisical run --env=test -- npx vitest run --config vitest.server.config.js src/tests/server/outreachTemplates.test.js src/tests/server/outreachCampaignService.unit.test.js src/tests/server/invoiceEmailSend.test.js src/tests/server/invoices.test.js
```
