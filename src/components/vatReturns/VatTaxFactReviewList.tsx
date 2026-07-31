import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import type { VatTaxFact } from '../../types/entities.ts'
import { formatEur } from '../../utils/invoiceTotals.ts'
import { commonVatSelection, taxCategoryUsesZeroRate } from '../../../shared/taxCategories.js'
import MoneyInput from '../invoices/MoneyInput.tsx'
import TaxCategorySelect from '../shared/TaxCategorySelect.tsx'
import VatRateSelect from '../shared/VatRateSelect.tsx'

const COMMON_RATES = [21, 9] as const

export interface VatFactClassification {
  category_code: string
  tax_jurisdiction_code: string
  rate: number
  taxable_base_cents: number
}

interface FactEdit {
  category: string | null
  jurisdiction: string
  rate: number | null
  base: number
}

interface Props {
  facts: VatTaxFact[]
  busy: boolean
  onConfirm: (fact: VatTaxFact, classification: VatFactClassification) => Promise<void>
  onConfirmAll: (items: { fact: VatTaxFact; classification: VatFactClassification }[]) => Promise<void>
}

function expectedTax(baseCents: number, rate: number): number {
  return Math.round((baseCents * rate) / 100)
}

function derivedBase(fact: VatTaxFact, rate: number): number {
  if (rate <= 0) return Number(fact.taxable_base_cents) || 0
  const tax = Number(fact.tax_amount_cents) || 0
  const sign = Math.sign(tax) || 1
  const absoluteTax = Math.abs(tax)
  const gross = Math.abs(Number(fact.transaction_amount_cents) || 0)
  const grossBase = gross - absoluteTax
  if (grossBase >= 0 && Math.abs(expectedTax(grossBase, rate) - absoluteTax) <= 1) {
    return grossBase * sign
  }
  return Math.round((absoluteTax * 100) / rate) * sign
}

function proposedRate(fact: VatTaxFact): number | null {
  const tax = Math.abs(Number(fact.tax_amount_cents) || 0)
  const gross = Math.abs(Number(fact.transaction_amount_cents) || 0)
  if (!tax || gross <= tax) return null
  const base = gross - tax
  return COMMON_RATES.find((rate) => Math.abs(expectedTax(base, rate) - tax) <= 1) ?? null
}

function proposedEdit(fact: VatTaxFact): FactEdit {
  const inferredRate = proposedRate(fact)
  const selection = inferredRate == null
    ? null
    : commonVatSelection(fact.tax_jurisdiction_code, inferredRate)
  if (selection && inferredRate != null) {
    return {
      category: selection.tax_category_code,
      jurisdiction: selection.tax_jurisdiction_code,
      rate: inferredRate,
      base: derivedBase(fact, inferredRate),
    }
  }
  return {
    category: fact.category_code === 'legacy_unclassified' ? null : fact.category_code,
    jurisdiction: fact.tax_jurisdiction_code,
    rate: Number(fact.rate) || null,
    base: Number(fact.taxable_base_cents) || 0,
  }
}

function classificationFor(edit: FactEdit): VatFactClassification | null {
  if (!edit.category || edit.rate == null) return null
  return {
    category_code: edit.category,
    tax_jurisdiction_code: edit.jurisdiction,
    rate: edit.rate,
    taxable_base_cents: edit.base,
  }
}

export default function VatTaxFactReviewList({ facts, busy, onConfirm, onConfirmAll }: Readonly<Props>) {
  const { t } = useTranslation('vatReturns')
  const [edits, setEdits] = useState<Record<string, FactEdit>>({})
  const editFor = (fact: VatTaxFact) => edits[String(fact.id)] ?? proposedEdit(fact)
  const proposals = facts.flatMap((fact) => {
    const rate = proposedRate(fact)
    const edit = editFor(fact)
    const classification = rate == null ? null : classificationFor(edit)
    return classification ? [{ fact, classification }] : []
  })

  function patchFact(fact: VatTaxFact, patch: Partial<FactEdit>) {
    setEdits((current) => ({
      ...current,
      [String(fact.id)]: { ...editFor(fact), ...patch },
    }))
  }

  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
          {t($ => $.workpaper.reviewCategories)}
        </Typography>
        {proposals.length > 0 && (
          <Button
            size="small"
            variant="outlined"
            disabled={busy}
            onClick={() => onConfirmAll(proposals)}
          >
            {t($ => $.workpaper.confirmProposals, { count: proposals.length })}
          </Button>
        )}
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t($ => $.workpaper.reviewIntro)}
      </Typography>

      {facts.map((fact) => {
        const edit = editFor(fact)
        const classification = classificationFor(edit)
        return (
          <Paper
            key={String(fact.id)}
            data-testid={`vat-fact-review-${fact.id}`}
            variant="outlined"
            sx={{ p: 1.5, mb: 1.5 }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'flex-start' }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                  {fact.transaction_description || t($ => $.workpaper.transactionFallback)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {fact.tax_point}
                </Typography>
              </Box>
              <Link component={RouterLink} to={`/ledger/${fact.transaction_id}`} target="_blank" variant="caption">
                {t($ => $.workpaper.openLedgerEntry)}
              </Link>
            </Box>

            <Box sx={{ display: 'flex', gap: 3, my: 1.5, flexWrap: 'wrap' }}>
              <Box>
                <Typography variant="caption" color="text.secondary">{t($ => $.workpaper.transactionAmount)}</Typography>
                <Typography variant="body2">{formatEur(fact.transaction_amount_cents)}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">{t($ => $.workpaper.vatAmount)}</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{formatEur(fact.tax_amount_cents)}</Typography>
              </Box>
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr auto' }, gap: 1, alignItems: 'start' }}>
              <VatRateSelect
                id={`vat-fact-${fact.id}-rate`}
                label={t($ => $.workpaper.rate)}
                country={edit.jurisdiction}
                value={edit.rate}
                categoryCode={edit.category}
                noVatLabel={t($ => $.workpaper.chooseRate)}
                disabled={busy}
                onChange={(rate, taxPatch) => patchFact(fact, {
                  rate,
                  category: taxPatch?.tax_category_code ?? null,
                  jurisdiction: taxPatch?.tax_jurisdiction_code ?? edit.jurisdiction,
                  ...(rate == null ? {} : { base: derivedBase(fact, rate) }),
                })}
              />
              <MoneyInput
                label={t($ => $.workpaper.taxableAmount)}
                cents={edit.base}
                disabled={busy}
                onChange={(base) => patchFact(fact, { base })}
                sx={{ width: '100%' }}
              />
              <Button
                variant="contained"
                disabled={busy || !classification}
                onClick={() => classification && onConfirm(fact, classification)}
                sx={{ whiteSpace: 'nowrap' }}
              >
                {t($ => $.actions.confirmCategory)}
              </Button>
            </Box>
            <Box sx={{ mt: 0.5 }}>
              <TaxCategorySelect
                direction={fact.direction}
                categoryCode={edit.category}
                jurisdictionCode={edit.jurisdiction}
                defaultJurisdiction={fact.tax_jurisdiction_code}
                rate={edit.rate}
                disabled={busy}
                onChange={(patch) => patchFact(fact, {
                  category: patch.tax_category_code,
                  jurisdiction: patch.tax_jurisdiction_code,
                  ...(patch.tax_category_code && taxCategoryUsesZeroRate(patch.tax_category_code, fact.direction)
                    ? { rate: 0 }
                    : {}),
                })}
              />
            </Box>
          </Paper>
        )
      })}
    </Box>
  )
}
