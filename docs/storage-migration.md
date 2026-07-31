# Tenant object-storage migration runbook

## Backblaze preparation

Create a private B2 bucket in the account region with default SSE-B2 encryption enabled.
Do not enable Object Lock: permanent tenant deletion must remove every object version.
Configure a lifecycle rule that expires hidden/old versions after the required recovery
window.

Create a standard application key scoped to this bucket with list, read, write, multipart,
and delete access. Do not use the master application key. Runtime mapping is:

```text
BACKBLAZE_KEYID  -> S3_ACCESS_KEY
BACKBLAZE_APPKEY -> S3_SECRET_KEY
```

Set `BACKBLAZE_ENDPOINT`, `BACKBLAZE_REGION`, and `BACKBLAZE_BUCKET` as deployment secrets.
The endpoint is the hostname `s3.<region>.backblazeb2.com`, without a URL scheme.

## Migration

1. Deploy and confirm `checkPrivateStorage.js` succeeds. All new tenant-scoped uploads now use B2;
   reads of old tenant keys fall back to RustFS only for a genuine 404.
2. Open **Super admin → Tenants** and run **Test connection**.
3. Open a tenant's storage-migration dialog and run **Inventory**. Every valid object under
   `tenants/<tenantId>/` is included regardless of category.
4. Run **Copy to Backblaze**. This is resumable and never deletes RustFS data.
5. Run **Validate copy**. Every RustFS tenant object is read and SHA-256 compared with B2;
   every database-referenced tenant key must be present in B2.
6. After reviewing the counts, run **Delete tenant copies from RustFS** and enter both exact
   confirmations. The worker validates again immediately before deleting.
7. Repeat for every tenant. Confirm all are `complete` or `not_required`, the cleanup queue
   has no pending migration entries, and quota statistics are current.

Copy, validation, and deletion run as PostgreSQL-backed jobs. A process restart releases the
expired lease and the next worker continues the operation. Retry a failed state from the same
dialog after correcting its safe error code.

## Rollback and finalization

Do not roll back to the old single-store application after new tenant uploads have reached
B2; it cannot read them. Roll back only to a release that understands both stores, or fix
forward. Take an independent RustFS snapshot before the first production source deletion.

After every tenant has completed and an observation period passes, remove the temporary
missing-only read fallback and dual-store tenant deletion behavior. Keep version-aware B2
tenant deletion and the migration history required for audit.
