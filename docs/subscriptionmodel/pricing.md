# Pricing rules and price snapshots

Pricing is a pure function of the module set, the billing interval and the live
rule catalog. It lives in `shared/pricing.js` and is imported by **both** the
server that charges and the frontend that quotes, so the number a customer reads
and the number they are billed are the same number by construction.

## The snapshot

Every subscription retains a complete snapshot of what it was priced at:

```json
{
  "modules": {
    "band":   { "plan": "gold",        "priceCents": 2000 },
    "artist": { "plan": "artist_gold", "priceCents": 1000 }
  },
  "subtotalCents": 3000,
  "discounts": [
    { "code": "dual_module_bundle", "name": "Two-module bundle", "version": 1,
      "type": "percentage", "value": 10, "amountCents": 300 }
  ],
  "totalCents": 2700
}
```

`validatePriceSnapshot` enforces that it ties back: the subtotal equals the sum
of the module prices, and the total equals the subtotal minus the discounts.

A subscription carries three of these, each answering a different question:

| Column | Question |
|---|---|
| `price_snapshot` / `total_cents` | What was the **current** period charged? |
| `next_price_snapshot` / `next_total_cents` | What will the **next renewal** charge? Also the durable mirror of the provider schedule's amount. |
| `pending_price_snapshot` / `pending_total_cents` | What will a **mid-cycle change** install once its prorated charge is paid? |

`subscription_payments.price_snapshot` records what each individual charge
billed, which is the audit trail and the basis for a refund.

## Pricing rules

A rule is a discount with conditions:

| Field | Meaning |
|---|---|
| `code` | Stable internal identifier, recorded in every snapshot: `dual_module_bundle`, `apr_2027_marketing` |
| `name` | Human-readable discount name, retained in the snapshot and shown in the billing calculation |
| `version` | Increments when the terms change; `(code, version)` is unique |
| `discount_type` | `percentage` (`percent`, `NUMERIC(5,2)`) or `fixed` (`amount_cents`) |
| `combinable` | `false` means "applies alone" |
| `is_active` | At most one live version per code |
| `effective_from` / `effective_to` | Half-open window `[from, to)` |
| `required_audiences` | All must be present; empty = any |
| `min_module_count` | The dual-module bundle sets this to 2 |
| `billing_intervals` | e.g. a yearly-only promo |
| `priority` | Application order; ties broken by `code` |

### How rules are selected

1. Filter to candidates: active, inside the window, covering the interval, and
   whose module conditions the subscription meets.
2. Sort by `priority`, then `code` — deterministic, never insertion order.
3. Walk the list. The first candidate always applies. Each later one applies
   **only if it and every already-applied rule** are `combinable`.

So a non-combinable rule is either the only discount or no discount at all.

### How amounts are computed

**Every discount is measured against the original subtotal**, never a running
total. Two stacked 10% and 5% rules take 300 and 150 off a 3000 subtotal — not
300 and 135. This makes the amounts independent of the order rules happen to
apply in, which is what stops "why did my discount shrink?" support tickets.

Percentages round to the nearest cent (`Math.round`). A fixed discount is
clamped to the subtotal, and the total is floored at zero.

## Versioning: why terms are never edited in place

A snapshot pins `{ code, version }`. If an admin could edit a live rule's
percentage, every snapshot that quoted it would silently start resolving to
different terms, and an existing price agreement would no longer be
reproducible.

So the admin API has no "edit the terms" operation. `POST /:id/versions`
**supersedes**: it retires the live version and inserts the next one, in one
transaction. Version numbers count up from the highest ever used, never from the
live one, so a retired number is never reused and `{ code, version }` stays
unambiguous. Only the cosmetic `name` is editable directly.

## Temporary discounts actually being temporary

A promo with an `effective_to` changes nothing about the subscription when it
lapses — the provider schedule would happily keep charging the promotional
amount for the rest of the customer's life.

`reconcileNextPeriodPricing` closes that: each tick it recomputes
`next_total_cents` against the live catalog and, when the amount has genuinely
moved, flags the provider schedule stale so it is replaced before the next
charge. A quiet tick costs one UPDATE and no provider traffic.

## Proration

```
remaining = max(0, periodEnd − now)
delta     = newTotal − oldTotal
charge    = delta <= 0 ? 0 : round(delta × remaining / (periodEnd − periodStart))
```

Never negative: a configuration that costs less takes effect at the next renewal
rather than refunding here. A non-positive period length throws rather than
inventing a number.
