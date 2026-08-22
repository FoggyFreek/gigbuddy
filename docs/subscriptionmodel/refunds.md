# Refunds

Two ways money goes back, one mechanism underneath.

## The five-day withdrawal window

Within **five days** of the charge that **opened the current period** —
the first trial-end recurring charge, a direct-signup conversion payment, or
the most recent renewal — a customer may cancel
immediately and get that charge back **in full**.

```
POST /api/billing/cancel { immediate: true }
```

- Access ends the moment the subscription is cancelled. The resolver reads
  status, so this does not wait for the scheduler.
- The provider schedule is cancelled and a refund for the full charge is issued.
- **Nothing is purged.** A cancellation is a lapse, not a downgrade: the customer
  falls back to the free floor and their data stays.

Outside the window the request is refused with `409 refund_window_closed`. It
deliberately does **not** fall back to a period-end cancellation — silently doing
something other than what was asked, in a flow about money, is worse than an
error the UI can explain.

The window is exposed on the read model as `refundEligibleUntil`, so the cancel
dialog offers the refund branch only while it is genuinely available.

### What is and is not covered

The window anchors on the **cycle-opening** charge. A mid-cycle proration charge
is not automatically refundable — the customer received the module they paid the
difference for. Those go through the admin path.

The window re-opens on every renewal, because each renewal is a fresh charge for
a fresh period.

## Super-admin partial refunds

Support requests arrive out of band (email, support desk — out of scope for the
product). An operator resolves them from `/admin/subscriptions`:

```
POST /api/admin/subscriptions/:id/refunds { paymentId, amountCents, note }
```

- Any settled payment of that subscription, any amount up to what is left.
- The subscription is **not** cancelled — this is a goodwill adjustment, not an
  exit.
- "Total refunded ≤ payment amount" is a SUM, which no constraint can express,
  so it is enforced in the service under a `FOR UPDATE` lock on the payment row.
- A **failed** refund never moved money, so it does not consume the refundable
  balance and the operator can retry the same amount.

## Why the local row is written first

`subscription_refunds` is the durable **intent**, committed before the provider
call — the same rule every other remote mutation follows. A crash between
"we decided to refund" and the provider call leaves a resumable `pending` row
rather than lost money, and the outbox operation makes the retry safe: a call
that already succeeded is skipped instead of refunding twice.

## The trap: a refund must not resurrect the subscription

Mollie does not model a refund as its own payment. It reports it as a status
change on the **original** payment: `paid → refunded`. That flows back through
the ordinary ingestion funnel, where an unpaid current-period charge normally
drops the subscription to `past_due`.

Without a guard, cancelling with a refund would therefore un-cancel the
subscription a moment later.

`setStatusGuarded` refuses to move a `canceled` subscription at all. Canceled is
terminal; that single condition is what makes the refund path safe, and
`billingRefunds.test.js` pins it.
