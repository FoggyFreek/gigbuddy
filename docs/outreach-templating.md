# Outreach templates, campaigns, and gig contracts

Outreach is a tenant-scoped promotion feature. Templates are venue-facing email templates;
there are no contract templates or gig-context templates. Existing templates and campaign
history remain readable after a subscription downgrade, while mutation and dispatch require
the `outreach` entitlement and `PLANNING_WRITE`.

Gig contracts are generated documents owned by the gig rather than the template system.
Generation and lifecycle changes require `FINANCE_MANAGE`; reads require `FINANCE_VIEW`.

## Architecture

- `shared/outreachFields.js` is the venue-email merge-field catalogue. Add new fields there
  and in the raw resolver; formatting, permission filtering, editor menus, and previews
  consume the catalogue.
- Merge processing is staged: resolve raw values, format for locale, render registered
  blocks, then merge. Missing required values skip an email recipient.
- Template JSON is the editable source. Rendered HTML and text are stored with it because
  React Email composition requires the live browser editor. A campaign freezes both before
  recipients are reviewed or sent.
- A one-recipient message and a bulk campaign use the same campaign model. The batch
  dispatcher chunks at 100 recipients; a contract attachment always uses the single-send
  dispatcher.
- A contract freezes the gig, venue, tenant and cost facts at generation. The fact-only PDF
  is rendered by `server/utils/renderGigContractPdf.js` with the tenant logo, full deal
  terms, a short mutual-agreement statement and signature spaces for band and venue. PDFs
  are tenant-keyed object-storage files.

## HTTP surface

- `/api/outreach/fields`
- `/api/outreach/templates[/:id]`
- `/api/outreach/sender`
- `/api/outreach/campaigns[/:id]` and `/:id/send`
- `/api/outreach/campaigns/suppressions/list[/:id]`
- `/api/gigs/:gigId/contracts`
- `/api/outreach/contracts/:id`, `/:id/pdf`, `/:id/countersign`, and `/:id/void`

All list endpoints are bounded and all repository queries include `tenant_id`. The send
endpoint is rate-limited per tenant. Provider calls use deterministic idempotency keys and
record each recipient independently, so a mixed provider response becomes `partial` rather
than rolling back successful deliveries.

## Deployment

Apply migrations 199-204 before deploying the application. The former email-template slice
is removed only at the application layer in this release; its table is intentionally left in
place for an expand/migrate/contract rollout.

Configure a tenant Resend API key first, then save a sender identity in Settings. Saving
checks that the exact from-address domain is verified in Resend. Suppressions are checked
again immediately before every dispatch; non-contract email includes list-unsubscribe
headers.

## Verification

Run:

```powershell
npm.cmd run type-check
npm.cmd run lint
npm.cmd run build
npm.cmd test -- --run src/promotion/outreach/__tests__/outreachMerge.test.js src/planning/gigs/__tests__/renderGigContractPdf.test.js
infisical run --env=test -- npx vitest run --config vitest.server.config.js src/tests/server/outreachTemplates.test.js
```
