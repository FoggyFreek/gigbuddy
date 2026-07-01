import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { Invoice, Tenant } from '../../types/entities.ts'
import type { InvoiceForm } from './invoiceFormHelpers.ts'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControlLabel from '@mui/material/FormControlLabel'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import Typography from '@mui/material/Typography'
import ImageIcon from '@mui/icons-material/Image'

interface InvoiceLogoHeaderProps {
  readOnly: boolean
  logoKey?: string
  invoice?: Invoice
  tenant?: Tenant
  bandHeading?: string
  logoBusy?: boolean
  logoInputRef: RefObject<HTMLInputElement | null>
  onLogoFile: (e: React.ChangeEvent<HTMLInputElement>) => void
  onLogoRemove: () => void
  form: InvoiceForm
  patchForm: (patch: Partial<InvoiceForm>) => void
}

export default function InvoiceLogoHeader({
  readOnly, logoKey, invoice, tenant, bandHeading,
  logoBusy, logoInputRef, onLogoFile, onLogoRemove, form, patchForm,
}: Readonly<InvoiceLogoHeaderProps>) {
  const { t } = useTranslation('invoices')
  const hasCustomLogo = Boolean(invoice?.custom_logo_path)
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mb: 3 }}>
      <Box>
        <input
          ref={logoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          onChange={onLogoFile}
        />
        {logoKey ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box
              component="img"
              src={`/api/files/${logoKey}`}
              alt={t($ => $.logo.alt)}
              sx={{ maxHeight: 64, maxWidth: 160, objectFit: 'contain', borderRadius: 1, border: '1px solid', borderColor: 'divider', p: 0.5, bgcolor: '#ffffff' }}
            />
            {!readOnly && (
              <Stack direction="row" spacing={0.5}>
                <Button size="small" disabled={logoBusy} onClick={() => logoInputRef.current?.click()}>
                  {t($ => $.logo.replace)}
                </Button>
                {hasCustomLogo && (
                  <Button size="small" disabled={logoBusy} onClick={onLogoRemove}>
                    {t($ => $.logo.remove)}
                  </Button>
                )}
              </Stack>
            )}
          </Box>
        ) : (
          <Button
            startIcon={<ImageIcon />}
            disabled={readOnly || logoBusy}
            onClick={() => logoInputRef.current?.click()}
            variant="outlined"
          >
            {t($ => $.logo.add)}
          </Button>
        )}
        {tenant?.logo_dark_path && (
          <FormControlLabel
            sx={{ mt: 0.5, ml: 0.5 }}
            control={
              <Switch
                size="small"
                checked={!!form.invert_logo}
                onChange={(e) => patchForm({ invert_logo: e.target.checked })}
                disabled={readOnly}
              />
            }
            label={<Typography variant="caption">{t($ => $.logo.useDark)}</Typography>}
          />
        )}
      </Box>

      <Box sx={{ textAlign: 'right' }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{bandHeading}</Typography>
        {tenant?.address_street && (
          <Typography variant="body2">{tenant.address_street}</Typography>
        )}
        {(tenant?.address_postal_code || tenant?.address_city) && (
          <Typography variant="body2">
            {[tenant?.address_postal_code, tenant?.address_city].filter(Boolean).join(' ')}
          </Typography>
        )}
        {tenant?.address_country && (
          <Typography variant="body2">{tenant.address_country}</Typography>
        )}
        {tenant?.kvk_number && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>KVK {tenant.kvk_number}</Typography>
        )}
        {tenant?.tax_id && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>BTW {tenant.tax_id}</Typography>
        )}
      </Box>
    </Box>
  )
}
