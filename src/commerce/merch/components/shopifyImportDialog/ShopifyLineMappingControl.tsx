import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import FormControl from '@mui/material/FormControl'
import ListSubheader from '@mui/material/ListSubheader'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import { useAccountingProfile } from '../../../../contexts/accountingProfileContext.ts'
import type { Account, Product, ShopifyLineItem, ShopifyLineMapping } from '../../../../types/entities.ts'
import TaxCategorySelect from '../../../../components/shared/TaxCategorySelect.tsx'
import VatRateSelect from '../../../../components/shared/VatRateSelect.tsx'
import {
  lineMappable,
  mappingValue,
  type TaxSelectionPatch,
} from '../useShopifyImportDialog.ts'

export interface ShopifyLineMappingControlProps {
  line: ShopifyLineItem
  mapping: ShopifyLineMapping | undefined
  activeProducts: Product[]
  revenueAccounts: Account[]
  onMappingSelect: (line: ShopifyLineItem, value: string) => void
  onVatChange: (
    lineId: string,
    mapping: Extract<ShopifyLineMapping, { type: 'revenue' }>,
    vat: number,
  ) => void
  onTaxChange: (
    lineId: string,
    mapping: Extract<ShopifyLineMapping, { type: 'revenue' }>,
    patch: TaxSelectionPatch,
  ) => void
  compact?: boolean
  allowProducts?: boolean
}

export function ShopifyLineMappingControl({
  line,
  mapping,
  activeProducts,
  revenueAccounts,
  onMappingSelect,
  onVatChange,
  onTaxChange,
  compact = false,
  allowProducts = true,
}: Readonly<ShopifyLineMappingControlProps>) {
  const { t } = useTranslation(['merch', 'common'])
  const { accountingCountry } = useAccountingProfile()

  if (!lineMappable(line)) {
    return (
      <Chip
        size="small"
        label={line.already_imported ? t($ => $.shopify.imported) : t($ => $.shopify.refunded)}
        color={line.already_imported ? 'success' : 'default'}
      />
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: compact ? 'column' : 'row', gap: 1, alignItems: compact ? 'stretch' : 'center' }}>
      <FormControl size="small" sx={compact ? { width: '100%' } : { minWidth: 200 }}>
        <Select
          value={mappingValue(mapping)}
          onChange={(event) => onMappingSelect(line, event.target.value)}
        >
          {allowProducts && activeProducts.length > 0 && (
            <ListSubheader>{t($ => $.shopify.productsGroup)}</ListSubheader>
          )}
          {allowProducts && activeProducts.map((product) => (
            <MenuItem key={String(product.id)} value={`product:${product.id}`}>{product.name}</MenuItem>
          ))}
          {revenueAccounts.length > 0 && (
            <ListSubheader>{t($ => $.shopify.revenueAccountsGroup)}</ListSubheader>
          )}
          {revenueAccounts.map((account) => (
            <MenuItem key={String(account.code)} value={`revenue:${account.code}`}>
              {account.code} — {account.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {mapping?.type === 'revenue' && (
        <VatRateSelect
          id={`shopify-line-${line.id}-vat-rate`}
          label={t($ => $.shopify.vat)}
          country={accountingCountry}
          value={Number(mapping.vat_rate)}
          categoryCode={mapping.tax_category_code}
          onChange={(rate, taxPatch) => {
            const nextMapping = { ...mapping, ...(taxPatch ?? {}) }
            onVatChange(line.id, nextMapping, rate ?? 0)
          }}
          fullWidth={false}
          sx={compact ? { alignSelf: 'flex-start', minWidth: 220 } : { minWidth: 210 }}
        />
      )}
      {mapping?.type === 'revenue' && (
        <Box>
          <TaxCategorySelect
            direction="sale"
            categoryCode={mapping.tax_category_code}
            jurisdictionCode={mapping.tax_jurisdiction_code}
            defaultJurisdiction={accountingCountry}
            rate={Number(mapping.vat_rate)}
            onChange={(patch) => onTaxChange(line.id, mapping, patch)}
          />
        </Box>
      )}
    </Box>
  )
}
