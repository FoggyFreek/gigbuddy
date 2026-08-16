# The modular subscription model

One customer, one trial, one cycle, one renewal payment — with band and artist
sold as **modules** of a single subscription.

This directory is the product-level description of that model. The code-level
map and the invariants live in `.claude/skills/subscription-billing/SKILL.md`;
this is the "why", written so someone can reason about the commercial behaviour
without reading `billingService.js`.

- [`lifecycle.md`](lifecycle.md) — the state machine, from trial to cancellation.
- [`pricing.md`](pricing.md) — pricing rules, discounts and the price snapshot.
- [`refunds.md`](refunds.md) — the five-day withdrawal window and admin refunds.
- [`../architecture-decisions/001-trial-mandate-verification.md`](../architecture-decisions/001-trial-mandate-verification.md)
  — the mandate-verification decision for trial continuation.

## The shape in one page

```
Subscription (one per user, month or year)
├── band module    — silver | gold          (optional)
├── artist module  — artist_gold            (optional)
└── price snapshot — subtotal − discounts = total
```

A module is a **purchase**. Having no module for a ladder is not an error state:
it is exactly what "on the free plan" means, and the entitlement resolver falls
back to that ladder's free floor. This is why a fallback plan can never be
stored as a module — the DB trigger refuses it.

The two products stay independent in everything that matters for access: a band
tenant resolves through the band module, a personal workspace through the artist
module, and neither can leak into the other. What they now share is the
**commercial envelope** — one billing interval, one price, one renewal charge,
and one trial.

## Why modules instead of two subscriptions

The previous model gave a user up to two independent subscriptions, each with
its own trial, its own Mollie schedule and its own renewal payment. That is
defensible engineering and poor commerce: a customer buying both products got
two charges on different dates, two renewal emails, no way to discount the
combination, and a second trial to burn.

Collapsing to one subscription buys:

- **A bundle price.** Discounts apply to the combined subtotal, so
  `dual_module_bundle` is expressible at all.
- **One renewal.** One charge, one date, one advance notice.
- **One trial per customer**, sampled with whichever module they start on.
- **A much smaller downgrade flow.** Because both modules ride one cycle, a
  downgrade is a scheduled change to that cycle's amount rather than a whole
  replacement subscription at the provider. The cancel-old / create-replacement /
  repoint saga — and every race it had to survive — is gone.

The cost is that the subscription row no longer carries a plan. Anything
genuinely per-product (entitlement overrides, purge manifests, limit snapshots,
a scheduled plan change) moved onto the module row. That move is load-bearing:
an artist downgrade's limits snapshot carries `bands: 0`, and reading it from
the subscription would zero the owner's band cap.

## Invariants a change here must not break

1. **No paid access before an authoritatively-paid subscription charge.** The
   free trial is the deliberate exception; its payment boundary is defined by
   [ADR 001](../architecture-decisions/001-trial-mandate-verification.md).
2. **A lapse never deletes data.** Cancelling, failing a payment or running out
   of trial fallback-locks to the free floor. Only a *confirmed downgrade whose
   target plan became real* deletes anything.
3. **Adding capacity is never retroactive, removing it is immediate.** A
   confirmed downgrade binds its limits snapshot at once, while the features it
   removes stay granted until the period the customer paid for ends.
4. **The renewal date is the customer's.** A mid-cycle change charges only the
   prorated difference and leaves `current_period_end` alone.
5. **A quote and an invoice are the same number.** Both come from
   `shared/pricing.js`; the frontend never computes a price of its own.
