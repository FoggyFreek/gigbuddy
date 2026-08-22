import Divider from '@mui/material/Divider'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { formatEur } from '../../invoices/invoiceTotals.ts'
import type { BillingInterval } from '../../../commerce/billing/billing.ts'
import type { PriceSnapshot } from '../../../commerce/billing/pricing.ts'

interface Props {
  snapshot: PriceSnapshot | null
  interval: BillingInterval | null
  /** Shown as a footnote when the next renewal costs something different. */
  nextTotalCents?: number | null
  nextRenewalAt?: string | null
}

function Line({ label, value, strong = false }: Readonly<{
  label: string; value: string; strong?: boolean
}>) {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 2 }}>
      <Typography variant="body2" sx={{ fontWeight: strong ? 600 : 400 }}>{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: strong ? 600 : 400, whiteSpace: 'nowrap' }}>
        {value}
      </Typography>
    </Stack>
  )
}

/**
 * The price snapshot, line by line: one row per module, one per applied
 * discount, then the total. This is the same object the server charged, so what
 * the customer reads here is exactly what was (or will be) billed.
 */
export default function PriceBreakdown({
  snapshot, interval, nextTotalCents = null, nextRenewalAt = null,
}: Readonly<Props>) {
  const { t } = useTranslation('billing')

  if (!snapshot || Object.keys(snapshot.modules).length === 0) {
    return (
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {t($ => $.breakdown.empty)}
      </Typography>
    )
  }

  const cadence = interval === 'year'
    ? t($ => $.breakdown.perYear)
    : t($ => $.breakdown.perMonth)
  const showsNextPrice = nextTotalCents !== null
    && nextRenewalAt !== null
    && nextTotalCents !== snapshot.totalCents

  return (
    <Stack spacing={0.75}>
      <Typography variant="subtitle2">{t($ => $.breakdown.title)}</Typography>

      {Object.entries(snapshot.modules).map(([audience, entry]) => (
        <Line
          key={audience}
          label={`${t($ => $.modules[audience as 'band' | 'artist'])} — ${entry.plan}`}
          value={formatEur(entry.priceCents)}
        />
      ))}

      {snapshot.discounts.length > 0 && (
        <>
          <Line label={t($ => $.breakdown.subtotal)} value={formatEur(snapshot.subtotalCents)} />
          {snapshot.discounts.map((d) => (
            <Line
              key={`${d.code}@${d.version}`}
              label={t($ => $.breakdown.discount, { name: d.name ?? d.code })}
              value={`−${formatEur(d.amountCents)}`}
            />
          ))}
        </>
      )}

      <Divider sx={{ my: 0.5 }} />
      <Line
        label={`${t($ => $.breakdown.total)} (${cadence})`}
        value={formatEur(snapshot.totalCents)}
        strong
      />

      {showsNextPrice && (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {t($ => $.breakdown.nextRenewal, {
            date: new Date(nextRenewalAt), price: formatEur(nextTotalCents),
          })}
        </Typography>
      )}
    </Stack>
  )
}
