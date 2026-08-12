import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import { commonVatSelection, listTaxCategories } from '../../../shared/taxCategories.js'
import { VAT_COUNTRY_CODES } from '../../finance/vat/vatRates.ts'

interface Props {
  direction: 'sale' | 'purchase' | 'adjustment'
  categoryCode?: string | null
  jurisdictionCode?: string | null
  defaultJurisdiction: string
  rate?: number | null
  disabled?: boolean
  onChange: (patch: {
    tax_category_code: string | null
    tax_jurisdiction_code: string
  }) => void
}

export default function TaxCategorySelect({
  direction,
  categoryCode,
  jurisdictionCode,
  defaultJurisdiction,
  rate,
  disabled,
  onChange,
}: Readonly<Props>) {
  const { t } = useTranslation('common')
  const jurisdiction = (jurisdictionCode || defaultJurisdiction).toLowerCase()
  const commonSelection = commonVatSelection(defaultJurisdiction, rate)
  const isDutchSimpleSelection = defaultJurisdiction.toLowerCase() === 'nl'
    && jurisdiction === 'nl'
    && (!categoryCode || categoryCode === commonSelection?.tax_category_code)
  const [advanced, setAdvanced] = useState(!isDutchSimpleSelection)
  const showAdvanced = advanced || !isDutchSimpleSelection

  if (!showAdvanced && defaultJurisdiction.toLowerCase() === 'nl') {
    return (
      <Button
        size="small"
        variant="text"
        disabled={disabled}
        onClick={() => setAdvanced(true)}
        sx={{ justifyContent: 'flex-start', px: 0 }}
      >
        {t($ => $.vat.otherTreatment)}
      </Button>
    )
  }

  return (
    <Box>
      {commonSelection && (
        <Button
          size="small"
          variant="text"
          disabled={disabled}
          onClick={() => {
            onChange(commonSelection)
            setAdvanced(false)
          }}
          sx={{ mb: 0.5, px: 0 }}
        >
          {t($ => $.vat.useCommonRate)}
        </Button>
      )}
      <Box sx={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 1 }}>
      <TextField
        select
        size="small"
        label={t($ => $.vat.category)}
        value={categoryCode ?? ''}
        disabled={disabled}
        onChange={(event) => onChange({
          tax_category_code: event.target.value || null,
          tax_jurisdiction_code: jurisdiction,
        })}
      >
        <MenuItem value="">{t($ => $.vat.inferCategory)}</MenuItem>
        {listTaxCategories(direction).map((code) => (
          <MenuItem key={code} value={code}>
            {t($ => $.vat.categories[code as keyof typeof $.vat.categories])}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        size="small"
        label={t($ => $.vat.jurisdiction)}
        value={jurisdiction}
        disabled={disabled}
        onChange={(event) => onChange({
          tax_category_code: categoryCode ?? null,
          tax_jurisdiction_code: event.target.value.toLowerCase(),
        })}
      >
        {VAT_COUNTRY_CODES.map((code) => (
          <MenuItem key={code} value={code}>{code.toUpperCase()}</MenuItem>
        ))}
      </TextField>
      </Box>
    </Box>
  )
}
