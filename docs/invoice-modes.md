# Invoice modes

GigBuddy creates one customer invoice for a gig. The preferred invoice mode only changes how a booking fee is presented; it never changes what the customer owes.

The setting is tenant-specific and available under **Settings → Finance and accounting settings → Invoice mode** to members with finance-management permission.

## Combined

The booking fee remains inside the artist fee. This is the default and preserves the invoice presentation used before invoice modes were introduced.

For a €1,000 deal total that includes a €150 booking fee, the invoice shows:

| Description | Amount |
|---|---:|
| Artist fee | €1,000 |
| **Total** | **€1,000** |

## Specified

The same invoice states the booking fee separately. GigBuddy subtracts it from the artist fee before adding the booking-fee line; it does not add the fee on top of the deal total.

| Description | Amount |
|---|---:|
| Artist fee | €850 |
| Booking fee | €150 |
| **Total** | **€1,000** |

When a gig has no booking-fee basis, `specified` automatically behaves as `combined`, avoiding a zero-value booking-fee line. For a pure door deal, the artist fee is the settled door calculation and the booking fee is split from that settlement total.

The preference is applied when an invoice draft is created from a gig. The generated lines are then stored on the invoice, so changing the tenant preference later does not alter that draft or an invoice already issued.
