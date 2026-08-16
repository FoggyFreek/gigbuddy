# Anatomy of a billing operation

Every remote payment-provider mutation — create a customer, open a checkout,
charge a mandate, create or cancel a schedule, refund a payment — is a **billing
operation**: a row in `billing_operations` committed *before* the provider is
called, carrying a versioned command, an idempotency key and an idempotent local
completion step.

This page is the structural companion to [`lifecycle.md`](lifecycle.md): where
that one describes *when* the system charges, this one shows *which services and
repositories* carry that charge out, and who repairs it when a step is lost.

## The layers

```mermaid
flowchart TD
  subgraph callers["Callers — decide THAT a remote call is needed"]
    ROUTES["billing.js<br/>POST /api/billing/{trial,subscribe,checkout,<br/>modules,downgrade,cancel,sync}"]
    SVC["billing services (behind billingService.js)<br/>trial, checkout, module change,<br/>downgrade, cancel, read model<br/>each owns its business transaction"]
    REFUND["subscriptionRefundService.js<br/>withdrawal + admin partial refunds"]
    INGEST["paymentIngestionService.js<br/>one funnel for webhook + poll"]
    JOBS["jobs/billingTasks.js<br/>14 repair-only reconcile tasks"]
    WEBHOOK["publicBillingMollie.js<br/>/api/public/billing/mollie/webhook"]
  end

  subgraph saga["Outbox core — HOW the remote call is made"]
    SAGA["billingSaga.js<br/>ensureCustomerForUser, createConversionCheckout,<br/>createMandateVerificationCheckout, chargeModuleChange,<br/>repairSchedule, cancelRemoteSubscription,<br/>refundSubscriptionPayment"]
    OPSVC["billingOperationService.js<br/>executeBillingOperation, recoverBillingOperations<br/>lease, call, classify, complete, back off"]
    SHARED["billingShared.js<br/>idemKeys, webhook + redirect URLs, metadata"]
  end

  subgraph port["Provider port — never a concrete adapter"]
    FACTORY["paymentProvider/providerFactory.js<br/>getPaymentProvider()"]
    STATUS["statuses.js — canonical PAYMENT_STATUS,<br/>SCHEDULE_STATUS, REFUND_STATUS"]
    PERR["ProviderError<br/>retryable decides the outcome"]
    ADAPTER["adapters/mollieTypescript/<br/>MollieTypescriptProvider (SDK retries off)"]
  end

  subgraph repos["Repositories — the only SQL"]
    OPREPO["billingOperationRepository.js<br/>claimOperation, beginOperationAttempt,<br/>markOperationSucceeded/Failed/Completed,<br/>listRecoverableOperations, listUnreplayableOperations"]
    SUBREPO["subscriptionRepository.js<br/>setUserMollieCustomerId, setMandateLinkage,<br/>setPendingPaymentId, setScheduleStale,<br/>setBillingRepairNeeded"]
    PAYREPO["subscriptionPaymentRepository.js<br/>upsertPaymentOutcome"]
    REFREPO["subscriptionRefundRepository.js<br/>markRefundSucceeded, markRefundFailed"]
    MODREPO["subscriptionModuleRepository.js<br/>listModules (charge description)"]
    RECOV["subscriptionModuleChangeRecovery.js<br/>rollbackPendingModuleChange"]
    WHREPO["billingWebhookEventRepository.js<br/>recordWebhookReceived, markWebhookProcessed/Failed"]
  end

  subgraph db["PostgreSQL"]
    T_OPS[("billing_operations<br/>command_payload, result_payload, idempotency_key,<br/>attempt_count, next_attempt_at, lease_expires_at, completed_at")]
    T_SUBS[("subscriptions / subscription_modules / users")]
    T_PAY[("subscription_payments / subscription_refunds")]
    T_WH[("billing_webhook_events")]
  end

  subgraph admin["Read-only operator surface"]
    AROUTE["admin/operations/adminOperations.js<br/>GET /api/admin/operations/*"]
    ASVC["adminOperationService.js<br/>limitedCollection envelopes"]
    AREPO["adminOperationRepository.js<br/>summary, operation alerts,<br/>webhook failures, status drift"]
  end

  ROUTES --> SVC
  SVC --> SAGA
  REFUND --> SAGA
  INGEST --> SAGA
  JOBS --> SAGA
  JOBS -- "reconcileBillingOperations<br/>reconcileOrphanOperations" --> OPSVC
  WEBHOOK --> INGEST
  WEBHOOK --> WHREPO

  SAGA --> SHARED
  SAGA -- "claim the row first" --> OPREPO
  SAGA --> OPSVC
  OPSVC --> OPREPO
  OPSVC -- "remote call" --> FACTORY
  FACTORY --> ADAPTER
  ADAPTER --> STATUS
  ADAPTER --> PERR
  PERR --> OPSVC

  OPSVC -- "completion step" --> SUBREPO
  OPSVC --> PAYREPO
  OPSVC --> REFREPO
  OPSVC --> RECOV
  SAGA --> MODREPO
  RECOV --> SUBREPO
  RECOV --> MODREPO

  OPREPO --> T_OPS
  SUBREPO --> T_SUBS
  MODREPO --> T_SUBS
  RECOV --> T_SUBS
  PAYREPO --> T_PAY
  REFREPO --> T_PAY
  WHREPO --> T_WH

  AROUTE --> ASVC --> AREPO
  AREPO --> T_OPS
  AREPO --> T_WH
  AREPO --> T_SUBS
  AREPO --> T_PAY

  classDef caller fill:#e8f1ff,stroke:#3569a8,color:#10233f
  classDef core fill:#fff4d6,stroke:#a87916,color:#47350c
  classDef repo fill:#eaf7ec,stroke:#3d7c47,color:#17351c
  classDef store fill:#f0eef8,stroke:#6b5ca5,color:#241f3d
  class ROUTES,SVC,REFUND,INGEST,JOBS,WEBHOOK,AROUTE,ASVC caller
  class SAGA,OPSVC,SHARED,FACTORY,ADAPTER,STATUS,PERR core
  class OPREPO,SUBREPO,PAYREPO,REFREPO,MODREPO,RECOV,WHREPO,AREPO repo
  class T_OPS,T_SUBS,T_PAY,T_WH store
```

The shape to remember: **callers decide, the saga describes, the operation
service executes, repositories persist.** A caller never imports an adapter and
never touches `billing_operations`; the operation service never decides business
policy — it only runs the stored command and applies the stored completion.

## One operation, step by step

```mermaid
sequenceDiagram
  participant C as Caller<br/>(service or job)
  participant S as billingSaga
  participant O as billingOperationService
  participant R as billingOperationRepository
  participant P as PaymentProvider port
  participant L as Local repositories

  C->>S: repairSchedule / chargeModuleChange / refund…
  Note over C,S: outside any DB transaction
  S->>S: idemKeys.* → deterministic key<br/>(amount included where it varies)
  S->>R: claimOperation(key, command_payload)
  R-->>S: existing row on retry (same key = same op)
  S->>O: assertOperationCommand + executeBillingOperation

  alt row already succeeded
    O->>L: completion step only (no remote call)
  else row failed_terminal
    O->>L: terminal completion (rollback / flag repair)
    O-->>C: ProviderError retryable=false
  else claimable
    O->>R: beginOperationAttempt (2-min lease, attempt_count++)
    O->>P: createCustomer / createCheckoutPayment /<br/>createRecurringPayment / createSchedule /<br/>cancelSchedule / createRefund + idempotencyKey
    alt provider succeeds
      P-->>O: resource id + canonical status
      O->>R: markOperationSucceeded(result_payload)
      O->>L: completion — linkCustomer, linkFirstPayment,<br/>linkModulePayment, linkSchedule, completeRefund
      O->>R: markOperationCompleted
    else ProviderError retryable
      O->>R: markOperationFailed('failed_retryable')<br/>next_attempt_at = 30s·2^n, capped at 1h
    else ProviderError terminal
      O->>R: markOperationFailed('failed_terminal')
      O->>L: rollback pending module change /<br/>mark refund failed / billing_repair_needed
    end
  end
```

Two crash windows exist, and the same repair covers both. If the process dies
**before or during** the remote call, the lease expires and the row is still
`pending`/`failed_retryable`. If it dies **after** provider success but **before**
the local completion, the row is `succeeded` with `completed_at IS NULL`.
`listRecoverableOperations` selects exactly those two shapes, and
`reconcileBillingOperations` re-runs `executeBillingOperation`, which skips the
provider call it already made.

## Who owns what

| Module | Kind | Responsibility |
| --- | --- | --- |
| `billingService.js` | facade | Aggregate re-export of the services below — the `/api/billing` surface. No logic lives here. |
| `subscriptionTrialService.js` | service | Starting the 30-day trial. |
| `subscriptionCheckoutService.js` | service | Direct signup and the priced conversion checkout. |
| `moduleChangeService.js` | service | Adding a module or moving one up: quote, proration, activate-first charge. |
| `moduleDowngradeService.js` | service | Lowering or removing a module: consent, manifest freeze, boundary scheduling. |
| `subscriptionCancelService.js` | service | Cancel at period end and resume (the immediate refund path lives in the refund service). |
| `billingReadService.js` | service | The `/billing` read model, the subscription serializer, and the manual sync. |
| `moduleCapacityService.js` | service | Capacity blockers: current usage across a ladder's tenants against a target plan's limits, under the growth-write lock set. |
| `billingPostCommit.js` | helper | The post-commit "reprice, then repair the provider schedule" step every billing write ends with. |
| `billingErrors.js` | helper | The expected-failure constants shared across those services. |
| `subscriptionRefundService.js` | service | Commits the refund intent locally, then refunds through the outbox; owns the withdrawal window and the over-refund `SUM` guard. |
| `paymentIngestionService.js` | service | The single funnel for webhook + poll outcomes; requests a schedule repair once a charge is authoritative. |
| `jobs/billingTasks.js` | job | Repair-only. `billing_operations` recovers work, `orphan_operations` warns about pre-migration rows with no stored command. |
| `billingSaga.js` | service | Builds the provider-neutral command and its completion, claims the outbox row, and delegates execution. Never runs inside a DB transaction. |
| `billingOperationService.js` | service | Lease, provider dispatch, error classification, backoff, and the idempotent completion step. |
| `billingShared.js` | helper | `idemKeys`, webhook/redirect URLs, metadata, period maths — the deterministic inputs an operation key depends on. |
| `billingOperationRepository.js` | repository | All `billing_operations` SQL: claim, lease, mark, recover. |
| `subscriptionRepository.js` | repository | Narrow single-column linkage updates the completion step writes (customer id, mandate, schedule staleness, repair flag). |
| `subscriptionPaymentRepository.js` | repository | `upsertPaymentOutcome` for the charge an operation opened. |
| `subscriptionRefundRepository.js` | repository | Flips the refund intent to succeeded/failed. |
| `subscriptionModuleChangeRecovery.js` | service | Rolls back a pending module change when its prorated charge terminally fails. |
| `billingWebhookEventRepository.js` | repository | Durable webhook-delivery audit — provider ids and normalized codes only. |
| `admin/operations/*` | route → service → repository | Read-only operator views over local state. Opening a dashboard never calls the provider. |

## Invariants this structure exists to protect

1. **Never a provider call inside a DB transaction.** Local state commits first;
   the remote call happens after, through the outbox.
2. **The row is committed before the call.** A crash can never lose the fact
   that money may have moved.
3. **The idempotency key is deterministic and reused on every attempt** — and it
   includes the amount wherever the amount can differ, so two differently-priced
   charges cannot collide.
4. **A reused key with a different command is a terminal error**
   (`operation_command_conflict`), not a silent overwrite.
5. **Retry policy has one owner.** The adapter's SDK retries are disabled; the
   outbox's bounded exponential backoff is the only retry.
6. **Recovery is idempotent in both directions** — the provider call is skipped
   when already succeeded, and the completion step is skipped once
   `completed_at` is set.
7. **Legacy rows without a stored command are never guessed at.** They surface
   as operator warnings and stay put.
