import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { formatEur } from '../../utils/invoiceTotals.ts'
import type { JournalAccountEffect, JournalEffects } from '../../utils/journalEffects.ts'

interface JournalEffectsOverlayProps {
  effects: JournalEffects
}

const AMOUNT_SX = { fontVariantNumeric: 'tabular-nums', minWidth: 76, textAlign: 'right' } as const

function EffectRow({ label, cents, tone, emphasize }: Readonly<{
  label: string
  cents: number
  tone: 'success.main' | 'error.main' | 'text.primary'
  emphasize?: boolean
}>) {
  return (
    <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'flex-end', alignItems: 'baseline' }}>
      <Typography
        variant="caption"
        noWrap
        sx={{ color: 'text.secondary', fontWeight: emphasize ? 600 : 400, maxWidth: 220 }}
      >
        {label}
      </Typography>
      <Typography variant="caption" sx={{ ...AMOUNT_SX, color: tone, fontWeight: emphasize ? 600 : 400 }}>
        {formatEur(cents)}
      </Typography>
    </Box>
  )
}

function EffectColumn({ rows, totalLabel, totalCents, tone }: Readonly<{
  rows: JournalAccountEffect[]
  totalLabel: string
  totalCents: number
  tone: 'success.main' | 'error.main'
}>) {
  return (
    <Box sx={{ minWidth: 240 }}>
      {rows.map((row) => (
        <EffectRow key={row.code} label={row.name ?? row.code} cents={row.amountCents} tone={tone} />
      ))}
      <Box sx={{ borderTop: 1, borderColor: 'divider', mt: 0.25, pt: 0.25 }}>
        <EffectRow label={totalLabel} cents={totalCents} tone={tone} emphasize />
      </Box>
    </Box>
  )
}

// Bottom-of-screen preview of what approving the selected journal entries would
// post: netted per-account debit and credit columns with totals and the
// remaining difference (non-zero means the selection would not balance).
export default function JournalEffectsOverlay({ effects }: Readonly<JournalEffectsOverlayProps>) {
  const { t } = useTranslation('journal')
  const { debit, credit, totalDebitCents, totalCreditCents, differenceCents } = effects
  if (!debit.length && !credit.length) return null

  return (
    <Paper
      data-testid="journal-effects"
      elevation={8}
      square
      sx={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 'appBar',
        borderTop: 1,
        borderColor: 'divider',
        px: 3,
        py: 1,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      <Box sx={{ maxWidth: '100%', overflowX: 'auto' }}>
        <Box sx={{ display: 'flex', gap: 4, alignItems: 'flex-end', justifyContent: 'flex-end' }}>
          <EffectColumn
            rows={debit}
            totalLabel={t($ => $.effects.totalDebit)}
            totalCents={totalDebitCents}
            tone="success.main"
          />
          <EffectColumn
            rows={credit}
            totalLabel={t($ => $.effects.totalCredit)}
            totalCents={totalCreditCents}
            tone="error.main"
          />
        </Box>
        <EffectRow
          label={t($ => $.effects.difference)}
          cents={differenceCents}
          tone={differenceCents === 0 ? 'text.primary' : 'error.main'}
          emphasize
        />
      </Box>
    </Paper>
  )
}
